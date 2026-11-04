param(
  [Parameter(Mandatory)][string]$MigrationRecord,
  [Parameter(Mandatory)][ValidateCount(2,2)][string[]]$ValidatedImages
)
$ErrorActionPreference = 'Stop'
$env:PATH = (Join-Path $env:USERPROFILE '.azure-kubelogin') + ';' + $env:PATH
$m = Get-Content -LiteralPath $MigrationRecord -Raw | ConvertFrom-Json -AsHashtable
$environment = $m.environment
if ($environment -notin @('test','prod') -or $m.cleanupCompleted) { throw 'An active Test or Production migration record is required' }
if (@($ValidatedImages | Where-Object { $_ -notmatch '@sha256:[a-f0-9]{64}$' }).Count) { throw 'Validated images must be pinned by digest' }
$context = $m.context
$namespace = 'file-operations'
$target = if ($environment -eq 'test') { 'probonolawdatatestsuffix' } else { 'probonolawdataprodsuffix' }
$source = if ($environment -eq 'test') { 'dataautomationlasnn5vo5p' } else { 'dataautomationlavdqzxqu4' }
$cache = if ($environment -eq 'test') { 'integritycachetestsuffix' } else { 'integritycacheprodsuffix' }
$vault = if ($environment -eq 'test') { 'probonolawakssecrets' } else { 'probonolawakssecretsprod' }
$uri = "https://$vault.vault.azure.net/secrets/file-operations-appsettings?api-version=7.4"
$token = az account get-access-token --resource https://vault.azure.net --query accessToken -o tsv
if ($LASTEXITCODE -ne 0) { throw 'Key Vault authentication failed' }
$headers = @{ Authorization = "Bearer $token" }
$secret = Invoke-RestMethod $uri -Headers $headers
$values = $secret.value | ConvertFrom-Json -AsHashtable
foreach ($entry in @(@('BLOB_CONNECTION_STRING',$cache),@('CHECKPOINT_STORAGE_CONNECTION_STRING',$source),@('TABLE_CONNECTION_STRING',$source))) {
  if ($values[$entry[0]] -notmatch "(^|;)AccountName=$($entry[1])(;|$)") { throw "Unexpected source account for $($entry[0])" }
}
if ($values.TABLE_NAME -and $values.TABLE_NAME -ne 'IngestionProgress') { throw 'Unexpected ingestion table' }
if ($values.INPUT_ACCOUNT_NAME -and $values.INPUT_ACCOUNT_NAME -ne $cache) { throw 'Unexpected input account' }
$updated = $values.Clone()
$updated.BLOB_CONNECTION_STRING = "https://$target.blob.core.windows.net"
$updated.CHECKPOINT_STORAGE_CONNECTION_STRING = "https://$target.blob.core.windows.net"
$updated.TABLE_CONNECTION_STRING = "https://$target.table.core.windows.net"
$updated.INPUT_ACCOUNT_NAME = $target
if ($updated.ContainsKey('EVIDENCE_QUEUE_STORAGE_CONNECTION_STRING')) {
  $updated.EVIDENCE_QUEUE_STORAGE_CONNECTION_STRING = "https://$target.blob.core.windows.net"
}
$names = @('data-ingestion-api','data-integrity-api','evidence-extraction','evidence-finalize','evidence-gather','evidence-reconcile','evidence-repair','evidence-review','file-ops-gateway','general-deletion','general-ingestion','general-ingestion-shard-1')
$deployments = @()
foreach ($name in $names) {
  $d = kubectl --context $context -n $namespace get deployment $name -o json | ConvertFrom-Json -AsHashtable
  if ($LASTEXITCODE -ne 0) { throw 'Deployment read failed' }
  if (@($d.spec.template.spec.containers | Where-Object { $_.image -notin $ValidatedImages }).Count) { throw "Validated image is not deployed on $name" }
  if (@($d.spec.template.spec.containers.env | Where-Object { $_.name -in @('BLOB_CONNECTION_STRING','CHECKPOINT_STORAGE_CONNECTION_STRING','TABLE_CONNECTION_STRING','INPUT_ACCOUNT_NAME','EVIDENCE_QUEUE_STORAGE_CONNECTION_STRING') }).Count) { throw "Storage environment overrides must be reconciled on $name" }
  $selector = ($d.spec.selector.matchLabels.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ','
  $deployments += @{ name=$name; replicas=$d.spec.replicas; selector=$selector }
}
$cron = kubectl --context $context -n $namespace get cronjob shared-resource-sync -o json | ConvertFrom-Json -AsHashtable
if ($LASTEXITCODE -ne 0) { throw 'CronJob read failed' }
if (@($cron.spec.jobTemplate.spec.template.spec.containers | Where-Object { $_.image -notin $ValidatedImages }).Count) { throw 'CronJob must also use the validated image' }
if (@($cron.spec.jobTemplate.spec.template.spec.containers.env | Where-Object { $_.name -in @('BLOB_CONNECTION_STRING','CHECKPOINT_STORAGE_CONNECTION_STRING','TABLE_CONNECTION_STRING','INPUT_ACCOUNT_NAME','EVIDENCE_QUEUE_STORAGE_CONNECTION_STRING') }).Count) { throw 'Scheduled storage environment overrides must be reconciled' }
$recordFile = Join-Path $env:TEMP "probonolaw-file-operations-$environment-cutover.json"
if (Test-Path -LiteralPath $recordFile) { throw 'A cutover record already exists; inspect it before retrying' }
$record = @{environment=$environment;source=$source;cache=$cache;target=$target;deployments=$deployments;cronWasSuspended=[bool]$cron.spec.suspend;startedAt=[datetime]::UtcNow.ToString('o');copyVerified=$false;cutover=$false;restored=$false;previousSecretVersion=$secret.id.Split('/')[-1]}
function Save-Record { $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $recordFile }
$patch = Join-Path $env:TEMP "probonolaw-file-cutover-$environment-patch.json"
function Set-Cron([bool]$suspended) {
  @{spec=@{suspend=$suspended}} | ConvertTo-Json -Compress | Set-Content -LiteralPath $patch
  kubectl --context $context -n $namespace patch cronjob shared-resource-sync --type merge --patch-file $patch
  if ($LASTEXITCODE -ne 0) { throw 'CronJob update failed' }
}
function Run-Migration([string[]]$Arguments) {
  kubectl --context $context -n $m.namespace exec $m.name -- env PYTHONPATH=/work/python:/home/site/wwwroot/.python_packages/lib/site-packages python @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Data migration or verification failed; source settings remain active' }
}
# Upload only code and allowlists; secret values stay in process memory.
foreach ($file in @('copy-storage-data.py','sync-storage-blobs.py','merge-storage-tables.py','copy-evidence-queues.py')) {
  Get-Content (Join-Path $PSScriptRoot $file) -Raw | kubectl --context $context -n $m.namespace exec -i $m.name -- python -c "import sys;open('/work/$file','w').write(sys.stdin.read())"
  if ($LASTEXITCODE -ne 0) { throw 'Migration tool upload failed' }
}
$prepare = @'
import json,sqlite3,sys,os,pathlib
environment=sys.argv[1]
for path in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
 try:command=path.read_bytes()
 except (PermissionError,FileNotFoundError,ProcessLookupError):continue
 if b'/work/sync-storage-blobs.py' in command:
  raise RuntimeError('Wait for the running blob baseline to finish before cutover')
plan=json.load(open('/work/'+environment+'.json'))
profile=plan['sources']['dataAutomation']
names=[name for name in profile['containers'] if name.startswith('file-operations-')]
assert len(names)==5
profile['containers']=names
json.dump(plan,open('/work/files.json','w'))
if not os.path.exists('/work/files.sqlite'):
 s=sqlite3.connect('/work/da.sqlite');t=sqlite3.connect('/work/files.sqlite');s.backup(t)
 t.execute('update settings set value=? where name=?',(json.dumps(names),'containers'));t.commit();t.close();s.close()
'@
$prepare | kubectl --context $context -n $m.namespace exec -i $m.name -- python - $environment
if ($LASTEXITCODE -ne 0) { throw 'File Operations selection preparation failed' }
Save-Record
try {
  Set-Cron $true
  # Let any already running scheduled sync finish before freezing its state.
  $active = kubectl --context $context -n $namespace get cronjob shared-resource-sync -o json | ConvertFrom-Json
  foreach ($job in $active.status.active) {
    kubectl --context $context -n $namespace wait --for=condition=Complete "job/$($job.name)" --timeout=300s
    if ($LASTEXITCODE -ne 0) { throw 'An active scheduled sync did not finish' }
  }
  foreach ($d in $deployments) {
    kubectl --context $context -n $namespace scale deployment $d.name --replicas=0
    if ($LASTEXITCODE -ne 0) { throw 'Writer pause failed' }
  }
  foreach ($d in $deployments) {
    kubectl --context $context -n $namespace wait --for=delete pod -l $d.selector --timeout=300s
    if ($LASTEXITCODE -ne 0) { throw 'A storage writer did not stop' }
  }
  Run-Migration @('/work/sync-storage-blobs.py','--plan','/work/files.json','--source','dataAutomation','--ledger','/work/files.sqlite','--workers','32','--writers-frozen')
  Run-Migration @('/work/sync-storage-blobs.py','--plan',"/work/$environment.json",'--source','integrityCache','--ledger','/work/integrity-cache.sqlite','--workers','16','--writers-frozen')
  Run-Migration @('/work/merge-storage-tables.py','--plan','/work/files.json','--source','dataAutomation','--copy')
  Run-Migration @('/work/copy-evidence-queues.py','--source-account',$cache,'--target-account',$target,'--journal','/work/evidence-queues.sqlite','--writers-frozen')
  $record.copyVerified=$true; Save-Record
  $current = Invoke-RestMethod $uri -Headers $headers
  if ($current.id -ne $secret.id) { throw 'Key Vault settings changed during migration' }
  $body = @{value=($updated | ConvertTo-Json -Depth 20 -Compress);attributes=$secret.attributes}
  if ($null -ne $secret.contentType) { $body.contentType=$secret.contentType }
  if ($null -ne $secret.tags) { $body.tags=$secret.tags }
  $result = Invoke-RestMethod $uri -Method Put -Headers $headers -ContentType application/json -Body ($body | ConvertTo-Json -Depth 22 -Compress)
  $record.secretVersion=$result.id.Split('/')[-1];$record.cutover=$true;Save-Record
} finally {
  $restored=$true
  foreach ($d in $deployments) {
    kubectl --context $context -n $namespace scale deployment $d.name "--replicas=$($d.replicas)"
    if ($LASTEXITCODE -ne 0) { $restored=$false }
  }
  Set-Cron $record.cronWasSuspended
  $record.restored=$restored;Save-Record
}
foreach ($d in $deployments) {
  kubectl --context $context -n $namespace rollout status "deployment/$($d.name)" --timeout=300s
  if ($LASTEXITCODE -ne 0) { throw 'A workload did not become ready; inspect before any rollback of live data' }
}
$record.rolloutVerified=$true;$record.completedAt=[datetime]::UtcNow.ToString('o');Save-Record
