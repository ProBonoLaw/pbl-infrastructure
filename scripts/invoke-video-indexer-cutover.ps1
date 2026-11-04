param([Parameter(Mandatory)][ValidateSet('test','prod')][string]$Environment)
$ErrorActionPreference='Stop'
$env:PATH=(Join-Path $env:USERPROFILE '.azure-kubelogin')+';'+$env:PATH
$access=Get-Content (Join-Path $env:TEMP "probonolaw-retirement-access-$Environment.json") -Raw|ConvertFrom-Json
$target=Get-Content (Join-Path $env:TEMP "probonolaw-video-indexer-replacement-$Environment.json") -Raw|ConvertFrom-Json
if(!$access.ready -or $access.cleanupCompleted -or !$target.ready -or $target.environment -ne $Environment){throw 'Active migration and target records required'}
$recordPath=Join-Path $env:TEMP "probonolaw-video-indexer-cutover-$Environment.json"
if(Test-Path $recordPath){throw 'Cutover record already exists; inspect and resume explicitly'}
$context=$access.context;$namespace='file-operations'
$oldId=if($Environment -eq 'test'){'00000000-0000-4000-8000-00000000000c'}else{'00000000-0000-4000-8000-00000000000d'}
$vault=if($Environment -eq 'test'){'probonolawakssecrets'}else{'probonolawakssecretsprod'}
$uri="https://$vault.vault.azure.net/secrets/file-operations-appsettings?api-version=7.4"
$token=az account get-access-token --resource https://vault.azure.net --query accessToken -o tsv
if($LASTEXITCODE -ne 0){throw 'Key Vault authentication failed'}
$headers=@{Authorization="Bearer $token"}
$secret=Invoke-RestMethod $uri -Headers $headers
$values=$secret.value|ConvertFrom-Json -AsHashtable
if($values.VIDEO_INDEXER_ACCOUNT_ID -ne $oldId -or $values.INPUT_ACCOUNT_NAME -ne $target.storage){throw 'Unexpected current Video Indexer or storage settings'}
$updated=$values.Clone()
$updated.VIDEO_INDEXER_ACCOUNT_NAME=$target.name
$updated.VIDEO_INDEXER_ACCOUNT_ID=$target.accountId
$updated.VIDEO_INDEXER_LOCATION='eastus'
$updated.VIDEO_INDEXER_SUBSCRIPTION_ID=$target.subscription
$updated.VIDEO_INDEXER_RESOURCE_GROUP='video-indexer'
$updated.VIDEO_INDEXER_ARM_API_VERSION='2025-04-01'
$null=$updated.Remove('VIDEO_INDEXER_ACCESS_TOKEN')
$names=@('file-ops-gateway','general-ingestion','general-ingestion-shard-1','evidence-extraction','evidence-finalize','evidence-gather','evidence-reconcile','evidence-repair','evidence-review','general-deletion','data-ingestion-api','data-integrity-api')
$deployments=@()
foreach($name in $names){
  $d=kubectl --context $context -n $namespace get deployment $name -o json|ConvertFrom-Json -AsHashtable
  if($LASTEXITCODE -ne 0){throw 'Deployment lookup failed'}
  if(@($d.spec.template.spec.containers.env|Where-Object {$_.name -like 'VIDEO_INDEXER_*'}).Count){throw 'Video Indexer environment overrides require reconciliation'}
  $selector=($d.spec.selector.matchLabels.GetEnumerator()|ForEach-Object {"$($_.Key)=$($_.Value)"}) -join ','
  $deployments+=@{name=$name;replicas=$d.spec.replicas;selector=$selector}
}
$cron=kubectl --context $context -n $namespace get cronjob shared-resource-sync -o json|ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Scheduled sync lookup failed'}
$record=[ordered]@{environment=$Environment;previousSecretVersion=$secret.id.Split('/')[-1];oldAccountId=$oldId;newAccountId=$target.accountId;deployments=$deployments;cronWasSuspended=[bool]$cron.spec.suspend;startedAt=[DateTimeOffset]::UtcNow.ToString('o');runtimeVerified=$false;cutover=$false;restored=$false}
function Save{$record|ConvertTo-Json -Depth 14|Set-Content -LiteralPath $recordPath -Encoding utf8}
function Set-Cron([bool]$suspended){
  $patch=Join-Path $env:TEMP "probonolaw-video-indexer-$Environment-cron-patch.json"
  @{spec=@{suspend=$suspended}}|ConvertTo-Json -Compress|Set-Content -LiteralPath $patch
  kubectl --context $context -n $namespace patch cronjob shared-resource-sync --type merge --patch-file $patch
  if($LASTEXITCODE -ne 0){throw 'CronJob update failed'}
}
function Run-Python([string]$Code){
  $Code | kubectl --context $context -n $access.namespace exec -i $access.name -- env PYTHONPATH=/work/python python - $Environment
  if($LASTEXITCODE -ne 0){throw 'Video library precondition failed'}
}
function Write-Settings($Settings){
  $body=@{value=($Settings|ConvertTo-Json -Depth 30 -Compress);attributes=$secret.attributes}
  if($secret.contentType){$body.contentType=$secret.contentType}
  if($secret.tags){$body.tags=$secret.tags}
  Invoke-RestMethod $uri -Method Put -Headers $headers -ContentType application/json -Body ($body|ConvertTo-Json -Depth 32 -Compress)
}
Run-Python @'
import json,sys
v=json.load(open('/work/video-library-verification.json'))
assert v['environment']==sys.argv[1] and v['videoLibraryVerified']
print(json.dumps({'verifiedLibrary':v['count']}))
'@
Get-Content (Join-Path $PSScriptRoot 'verify-video-indexer-runtime.py') -Raw | kubectl --context $context -n $access.namespace exec -i $access.name -- python -c 'import sys,pathlib;pathlib.Path("/work/verify-video-indexer-runtime.py").write_text(sys.stdin.read())'
if($LASTEXITCODE -ne 0){throw 'Runtime verifier upload failed'}
Save
try{
  Set-Cron $true
  foreach($active in $cron.status.active){
    kubectl --context $context -n $namespace wait --for=condition=Complete "job/$($active.name)" --timeout=300s
    if($LASTEXITCODE -ne 0){throw 'Scheduled sync did not drain'}
  }
  foreach($d in $deployments|Where-Object name -ne 'data-integrity-api'){
    kubectl --context $context -n $namespace scale deployment $d.name --replicas=0
    if($LASTEXITCODE -ne 0){throw 'Submission pause failed'}
  }
  foreach($d in $deployments|Where-Object name -ne 'data-integrity-api'){
    kubectl --context $context -n $namespace wait --for=delete pod -l $d.selector --timeout=300s
    if($LASTEXITCODE -ne 0){throw 'A submission workload did not stop'}
  }
  Run-Python @'
import sys,json,importlib.util,time
s=importlib.util.spec_from_file_location('vi','/work/video-indexer-retirement.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
c=m.CONFIG[sys.argv[1]];v=m.VideoIndexer(c['subscription'],c['oldName'],c['oldId'])
expected=json.load(open('/work/video-library-verification.json'))
deadline=time.monotonic()+600
while True:
 videos=v.videos()
 assert {x['id'] for x in videos}=={x['oldVideoId'] for x in expected['checks']},'New arrivals require migration'
 if all(x['state']=='Processed' for x in videos):break
 if time.monotonic()>deadline:raise RuntimeError('Existing indexing did not drain')
 time.sleep(10)
print(json.dumps({'sourceLibraryDrained':len(videos)}))
'@
  kubectl --context $context -n $namespace scale deployment data-integrity-api --replicas=0
  if($LASTEXITCODE -ne 0){throw 'Integrity service pause failed'}
  kubectl --context $context -n $namespace wait --for=delete pod -l app=data-integrity-api --timeout=300s
  if($LASTEXITCODE -ne 0){throw 'Integrity requests did not drain'}
  $current=Invoke-RestMethod $uri -Headers $headers
  if($current.id -ne $secret.id){throw 'Settings changed during the pause'}
  $written=Write-Settings $updated
  $record.secretVersion=$written.id.Split('/')[-1];$record.cutover=$true;Save
  $integrity=$deployments|Where-Object name -eq 'data-integrity-api'
  kubectl --context $context -n $namespace scale deployment data-integrity-api "--replicas=$($integrity.replicas)"
  if($LASTEXITCODE -ne 0){throw 'Integrity service restart failed'}
  kubectl --context $context -n $namespace rollout status deployment/data-integrity-api --timeout=300s
  if($LASTEXITCODE -ne 0){throw 'Integrity service did not become ready'}
  $mounted=kubectl --context $context -n $namespace exec deployment/data-integrity-api -- cat /mnt/keyvault/appsettings.json | ConvertFrom-Json -AsHashtable
  if($LASTEXITCODE -ne 0 -or $mounted.VIDEO_INDEXER_ACCOUNT_ID -ne $target.accountId -or $mounted.VIDEO_INDEXER_ACCOUNT_NAME -ne $target.name -or $mounted.VIDEO_INDEXER_ARM_API_VERSION -ne '2025-04-01' -or $mounted.ContainsKey('VIDEO_INDEXER_ACCESS_TOKEN')){throw 'Mounted runtime Video Indexer settings mismatch'}
  $record.mountedSettingsVerified=$true;Save
  kubectl --context $context -n $access.namespace exec $access.name -- env PYTHONPATH=/work/python python /work/verify-video-indexer-runtime.py $Environment
  if($LASTEXITCODE -ne 0){throw 'Application Video Indexer verification failed'}
  $record.runtimeVerified=$true;Save
}finally{
  if($record.cutover -and !$record.runtimeVerified){
    kubectl --context $context -n $namespace scale deployment data-integrity-api --replicas=0
    if($LASTEXITCODE -ne 0){$record.rollbackBlocked='Integrity service scale-down failed';Save;throw 'Rollback stopped: integrity service could not be paused; workloads remain suspended'}
    kubectl --context $context -n $namespace wait --for=delete pod -l app=data-integrity-api --timeout=300s
    if($LASTEXITCODE -ne 0){$record.rollbackBlocked='Integrity pods did not terminate';Save;throw 'Rollback stopped: integrity pods did not terminate; workloads remain suspended'}
    $rollback=Write-Settings $values
    $record.rollbackSecretVersion=$rollback.id.Split('/')[-1];$record.rolledBack=$true;Save
  }
  $restored=$true
  foreach($d in $deployments){
    kubectl --context $context -n $namespace scale deployment $d.name "--replicas=$($d.replicas)"
    if($LASTEXITCODE -ne 0){$restored=$false}
  }
  Set-Cron $record.cronWasSuspended
  $record.restored=$restored;Save
}
foreach($d in $deployments){
  kubectl --context $context -n $namespace rollout status "deployment/$($d.name)" --timeout=300s
  if($LASTEXITCODE -ne 0){throw 'A workload did not become ready'}
}
$record.rolloutVerified=$true;$record.completedAt=[DateTimeOffset]::UtcNow.ToString('o');Save
Write-Output "$Environment Video Indexer cutover and application verification complete"
