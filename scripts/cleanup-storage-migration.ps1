param([Parameter(Mandatory)][string]$MigrationRecord)
$ErrorActionPreference='Stop'
$env:PATH=(Join-Path $env:USERPROFILE '.azure-kubelogin')+';'+$env:PATH
$m=Get-Content -LiteralPath $MigrationRecord -Raw | ConvertFrom-Json -AsHashtable
if($m.cleanupCompleted){'Migration access was already removed';return}
if($m.environment -notin @('test','prod') -or $m.name -notmatch '^storage-migration-[a-f0-9]{8}$' -or $m.namespace -ne 'aimie-operations'){throw 'Unexpected migration identity record'}
$cutover=Get-Content (Join-Path $env:TEMP "probonolaw-file-operations-$($m.environment)-cutover.json") -Raw | ConvertFrom-Json
if(-not($cutover.copyVerified -and $cutover.cutover -and $cutover.restored -and $cutover.rolloutVerified -and $cutover.runtimeDataAccessVerified)){throw 'Complete and verify runtime cutover before removing migration access'}
$token=az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
if($LASTEXITCODE -ne 0){throw 'ARM authentication failed'}
$headers=@{Authorization="Bearer $token"}
function Read-Arm([string]$id,[string]$version){
 try{Invoke-RestMethod "https://management.azure.com${id}?api-version=$version" -Headers $headers}
 catch{if([int]$_.Exception.Response.StatusCode -eq 404){return $null};throw}
}
function Save-Record{$m | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $MigrationRecord}
$identity=Read-Arm $m.identityId '2023-01-31'
if($identity -and $identity.properties.principalId -ne $m.principalId){throw 'Identity principal differs from migration record'}
if($m.assignments.Count -ne 9 -or @($m.assignments | Select-Object -Unique).Count -ne 9){throw 'Unexpected temporary assignment inventory'}
foreach($id in $m.assignments){
 if(-not $id.StartsWith("/subscriptions/$($m.subscription)/",[StringComparison]::OrdinalIgnoreCase)){throw 'Assignment subscription differs'}
 $assignment=Read-Arm $id '2022-04-01'
 if($assignment -and $assignment.properties.principalId -ne $m.principalId){throw 'Assignment belongs to another principal'}
}
$role=Read-Arm $m.roleDefinitionId '2022-04-01'
if($role -and $role.properties.type -ne 'CustomRole'){throw 'Refusing to remove a built-in role'}
$pod=kubectl --context $m.context -n $m.namespace get pod $m.name --ignore-not-found -o json | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Migration pod lookup failed'}
if($pod){
 if($pod.spec.serviceAccountName -ne $m.name){throw 'Unexpected pod service account'}
 $code="import sqlite3,json;c=sqlite3.connect('file:/work/evidence-queues.sqlite?mode=ro',uri=True);r=c.execute('select count(*) from receipts').fetchone()[0];v=c.execute('select count(*) from queues where verified=1').fetchone()[0];assert r==0 and v==6,'Queue visibility recovery is incomplete';print(json.dumps({'pendingReceipts':r,'verifiedQueues':v}))"
 kubectl --context $m.context -n $m.namespace exec $m.name -- python -c $code
 if($LASTEXITCODE -ne 0){throw 'Queue recovery verification failed'}
}
kubectl --context $m.context -n $m.namespace delete pod $m.name --ignore-not-found --wait=true --timeout=60s
if($LASTEXITCODE -ne 0){throw 'Migration pod cleanup failed'}
kubectl --context $m.context -n $m.namespace delete serviceaccount $m.name --ignore-not-found
if($LASTEXITCODE -ne 0){throw 'Migration service account cleanup failed'}
$m.removedAssignments=@()
foreach($id in $m.assignments){
 if(Read-Arm $id '2022-04-01'){
  $null=Invoke-RestMethod "https://management.azure.com${id}?api-version=2022-04-01" -Method Delete -Headers $headers
 }
 $m.removedAssignments+=@($id);Save-Record
}
if($role){
 az role definition delete --name $m.roleDefinitionId.Split('/')[-1] --subscription $m.subscription
 if($LASTEXITCODE -ne 0){throw 'Temporary role definition cleanup failed'}
}
if($identity){
 az identity delete --ids $m.identityId --subscription $m.subscription
 if($LASTEXITCODE -ne 0){throw 'Temporary managed identity cleanup failed'}
}
foreach($id in $m.assignments){if(Read-Arm $id '2022-04-01'){throw 'A temporary role assignment remains'}}
if(Read-Arm $m.roleDefinitionId '2022-04-01'){throw 'Temporary role definition remains'}
if(Read-Arm $m.identityId '2023-01-31'){throw 'Temporary managed identity remains'}
$m.cleanupCompleted=$true;$m.cleanedUpAt=[datetime]::UtcNow.ToString('o');Save-Record
"$($m.environment): migration pod, service account, nine temporary grants, custom role, managed identity, and its federation removed"
