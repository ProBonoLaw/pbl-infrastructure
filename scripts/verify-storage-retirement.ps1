param([Parameter(Mandatory)][ValidateSet('test','prod')][string]$Environment)
$ErrorActionPreference='Stop'
$env:PATH=(Join-Path $env:USERPROFILE '.azure-kubelogin')+';'+$env:PATH
$access=Get-Content (Join-Path $env:TEMP "probonolaw-retirement-access-$Environment.json") -Raw|ConvertFrom-Json
$target=Get-Content (Join-Path $env:TEMP "probonolaw-video-indexer-replacement-$Environment.json") -Raw|ConvertFrom-Json
$cutover=Get-Content (Join-Path $env:TEMP "probonolaw-video-indexer-cutover-$Environment.json") -Raw|ConvertFrom-Json
if(!$cutover.runtimeVerified -or !$cutover.mountedSettingsVerified -or !$cutover.restored -or !$cutover.rolloutVerified -or $cutover.newAccountId -ne $target.accountId){throw 'Runtime cutover is incomplete'}
$suffix=if($Environment -eq 'test'){'testsuffix'}else{'prodsuffix'}
$expected=@("aimiedata$suffix","probonolawdata$suffix")
$accounts=az storage account list --subscription $target.subscription --only-show-errors -o json|ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Storage inventory failed'}
if(@(Compare-Object @($accounts.name|Sort-Object) @($expected|Sort-Object)).Count){throw 'Unexpected remaining storage accounts'}
foreach($account in $accounts){
  if($account.location -ne 'northcentralus' -or $account.resourceGroup -ne 'shared-storage-northcentral' -or $account.allowSharedKeyAccess -ne $false -or $account.allowBlobPublicAccess -ne $false -or $account.networkRuleSet.defaultAction -ne 'Deny'){throw 'Retained storage security differs'}
}
$token=az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
if($LASTEXITCODE -ne 0){throw 'ARM authentication failed'}
$headers=@{Authorization="Bearer $token"}
function Read-Arm([string]$id,[string]$version){
  try{Invoke-RestMethod "https://management.azure.com${id}?api-version=$version" -Headers $headers}
  catch{if([int]$_.Exception.Response.StatusCode -eq 404){return $null};throw}
}
$oldName=if($Environment -eq 'test'){'video-indexer-testsuffix001'}else{'video-indexer-prodsuffix001'}
$oldId="/subscriptions/$($target.subscription)/resourceGroups/video-indexer/providers/Microsoft.VideoIndexer/accounts/$oldName"
if(Read-Arm $oldId '2025-04-01'){throw 'Old Video Indexer still exists'}
$vi=Read-Arm $target.id '2025-04-01'
if(!$vi -or $vi.properties.accountId -ne $target.accountId -or $vi.properties.publicNetworkAccess -ne 'Disabled' -or $vi.properties.storageServices.resourceId.Split('/')[-1] -ne $target.storage){throw 'Replacement Video Indexer differs'}
$endpoint=Read-Arm $target.endpointId '2024-05-01'
if(!$endpoint -or $endpoint.location -ne 'northcentralus' -or $endpoint.properties.privateLinkServiceConnections[0].properties.privateLinkServiceConnectionState.status -ne 'Approved'){throw 'Replacement private endpoint not approved'}
$blobGrant=Read-Arm $target.storageAssignmentId '2022-04-01'
$runtimeGrant=Read-Arm $target.workloadAssignmentId '2022-04-01'
if($blobGrant.properties.principalId -ne $target.principalId -or $blobGrant.properties.roleDefinitionId.Split('/')[-1] -ne 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' -or $runtimeGrant.properties.principalId -ne $target.workloadPrincipalId){throw 'Persistent Video Indexer RBAC differs'}
$deployments=kubectl --context $access.context -n file-operations get deployments -o json|ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Workload inventory failed'}
foreach($original in $cutover.deployments){
  $d=$deployments.items|Where-Object {$_.metadata.name -eq $original.name}
  if(!$d -or $d.spec.replicas -ne $original.replicas -or $d.status.readyReplicas -ne $original.replicas -or $d.status.updatedReplicas -ne $original.replicas){throw 'A runtime workload is not restored and ready'}
}
$cron=kubectl --context $access.context -n file-operations get cronjob shared-resource-sync -o json|ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or [bool]$cron.spec.suspend -ne $cutover.cronWasSuspended){throw 'Scheduled sync state differs'}
$code=@'
import json,sys,importlib.util
from pathlib import Path
from azure.storage.blob import BlobServiceClient,ContentSettings
s=importlib.util.spec_from_file_location('vi','/work/video-indexer-retirement.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
environment=sys.argv[1];c=v.CONFIG[environment]
t=json.loads(Path('/work/video-indexer-target.json').read_text(encoding='utf-8-sig'))
library=json.loads(Path('/work/video-library-verification.json').read_text())
runtime=json.loads(Path('/work/video-indexer-runtime-verification.json').read_text())
expected=24 if environment=='test' else 12
assert library['environment']==environment and library['videoLibraryVerified'] and library['count']==expected
assert runtime['environment']==environment and runtime['accountId']==t['accountId'] and runtime['applicationIdentityVerified'] and runtime['ownedArtifactsRemoved']
current=v.VideoIndexer(c['subscription'],t['name'],t['accountId']).videos()
by_id={x['id']:x for x in current}
assert all(x['newVideoId'] in by_id and by_id[x['newVideoId']]['state']=='Processed' for x in library['checks'])
assert runtime['videoId'] not in by_id
result={'environment':environment,'runtimeVerified':True,'oldStorageDeleted':True,'videoLibraryVerified':True,'videoCount':expected,'newVideoIndexerAccountId':t['accountId'],'ownedCanaryRemoved':True}
blobs=BlobServiceClient(f"https://{c['storage']}.blob.core.windows.net",credential=v.credential)
blobs.get_container_client('video-indexer-retirement-archive').upload_blob(c['oldId']+'/retirement-completion.json',json.dumps(result,indent=2),overwrite=True,content_settings=ContentSettings(content_type='application/json'))
print(json.dumps(result))
'@
$verified=$code|kubectl --context $access.context -n $access.namespace exec -i $access.name -- env PYTHONPATH=/work/python python - $Environment|ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or !$verified.videoLibraryVerified){throw 'Final library verification failed'}
$record=[ordered]@{environment=$Environment;runtimeVerified=$true;oldStorageDeleted=$true;videoLibraryVerified=$true;oldVideoIndexerDeleted=$true;videoCount=$verified.videoCount;retainedStorage=$expected;retainedStorageSecurityVerified=$true;persistentVideoIndexerRbacVerified=$true;readyFileOperationsPods=($cutover.deployments.replicas|Measure-Object -Sum).Sum;verifiedAt=[DateTimeOffset]::UtcNow.ToString('o')}
$path=Join-Path $env:TEMP "probonolaw-storage-retirement-$Environment-completion.json"
$record|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $path -Encoding utf8
$record|ConvertTo-Json -Compress
