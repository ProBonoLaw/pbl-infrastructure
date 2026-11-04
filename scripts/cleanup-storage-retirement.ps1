param(
  [Parameter(Mandatory)][string]$MigrationRecord,
  [Parameter(Mandatory)][string]$CompletionRecord
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'storage-retirement-grants.ps1')
$env:PATH=(Join-Path $env:USERPROFILE '.azure-kubelogin')+';'+$env:PATH
$m=Get-Content -LiteralPath $MigrationRecord -Raw|ConvertFrom-Json -AsHashtable
$completed=Get-Content -LiteralPath $CompletionRecord -Raw|ConvertFrom-Json -AsHashtable
if($m.cleanupCompleted){'Retirement access was already removed';return}
if($m.environment -notin @('test','prod') -or $m.name -notmatch '^storage-retirement-[a-f0-9]{8}$' -or $m.namespace -ne 'aimie-operations'){throw 'Unexpected retirement identity record'}
if($completed.environment -ne $m.environment -or !$completed.runtimeVerified -or !$completed.oldStorageDeleted -or !$completed.videoLibraryVerified){throw 'Retirement verification is incomplete'}
$expectedSub=if($m.environment -eq 'test'){'00000000-0000-4000-8000-000000000003'}else{'00000000-0000-4000-8000-000000000002'}
if($m.subscription -ne $expectedSub){throw 'Subscription mismatch'}
$expectedIdentity="/subscriptions/$expectedSub/resourceGroups/shared-storage-northcentral/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$($m.name)"
if(!$m.identityId.Equals($expectedIdentity,[StringComparison]::OrdinalIgnoreCase)){throw 'Identity scope mismatch'}
$token=az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
if($LASTEXITCODE -ne 0){throw 'ARM authentication failed'}
$headers=@{Authorization="Bearer $token"}
function Read-Arm([string]$id,[string]$version){
  try{Invoke-RestMethod "https://management.azure.com${id}?api-version=$version" -Headers $headers}
  catch{if([int]$_.Exception.Response.StatusCode -eq 404){return $null};throw}
}
function Save{$m|ConvertTo-Json -Depth 18|Set-Content -LiteralPath $MigrationRecord -Encoding utf8}
$identity=Read-Arm $m.identityId '2023-01-31'
if($identity -and $identity.properties.principalId -ne $m.principalId){throw 'Identity principal mismatch'}
$plan=Get-RetirementGrantPlan $m.environment $m.roleDefinitionId $m.videoIndexerRoleDefinitionId
if(!$m.videoIndexerRoleDefinitionId -or @($m.assignments|Select-Object -Unique).Count -ne $plan.arm.Count -or @($m.cosmosAssignments.id|Select-Object -Unique).Count -ne $plan.cosmos.Count){throw 'Unexpected temporary assignment inventory; resume setup to journal all grants'}
foreach($id in $m.assignments){
  if(!$id.StartsWith("/subscriptions/$expectedSub/",[StringComparison]::OrdinalIgnoreCase)){throw 'Assignment subscription mismatch'}
  $a=Read-Arm $id '2022-04-01'
  if($a -and $a.properties.principalId -ne $m.principalId){throw 'Assignment belongs to another principal'}
  if($a -and !@($plan.arm|Where-Object {$_.scope -eq $a.properties.scope -and $_.role -eq $a.properties.roleDefinitionId}).Count){throw 'Assignment is outside the retirement grant plan'}
}
foreach($assignment in $m.cosmosAssignments){
  $expected=$plan.cosmos|Where-Object account -eq $assignment.account|Select-Object -First 1
  if(!$expected -or !$assignment.id.StartsWith("$($expected.accountId)/sqlRoleAssignments/",[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected Cosmos assignment scope'}
  $a=Read-Arm $assignment.id '2024-05-15'
  if($a -and $a.properties.principalId -ne $m.principalId){throw 'Cosmos assignment belongs to another principal'}
  if($a -and !@($plan.cosmos|Where-Object {$_.scope -eq $a.properties.scope -and $_.role -eq $a.properties.roleDefinitionId}).Count){throw 'Cosmos assignment is outside the retirement grant plan'}
}
$role=Read-Arm $m.roleDefinitionId '2022-04-01'
if($role -and ($role.properties.type -ne 'CustomRole' -or $role.properties.roleName -notlike 'Storage retirement source reader *')){throw 'Unexpected custom role'}
$pod=kubectl --context $m.context -n $m.namespace get pod $m.name --ignore-not-found -o json|ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'Pod lookup failed'}
if($pod -and $pod.spec.serviceAccountName -ne $m.name){throw 'Unexpected pod service account'}
kubectl --context $m.context -n $m.namespace delete pod $m.name --ignore-not-found --wait=true --timeout=60s
if($LASTEXITCODE -ne 0){throw 'Pod cleanup failed'}
kubectl --context $m.context -n $m.namespace delete serviceaccount $m.name --ignore-not-found
if($LASTEXITCODE -ne 0){throw 'Service account cleanup failed'}
$m.removedAssignments=@()
foreach($id in $m.assignments){
  if(Read-Arm $id '2022-04-01'){$null=Invoke-RestMethod "https://management.azure.com${id}?api-version=2022-04-01" -Method Delete -Headers $headers}
  $m.removedAssignments+=@($id);Save
}
foreach($assignment in $m.cosmosAssignments){
  if(Read-Arm $assignment.id '2024-05-15'){
    az cosmosdb sql role assignment delete --subscription $expectedSub -g shared-dbs --account-name $assignment.account --role-assignment-id $assignment.id.Split('/')[-1] --yes --only-show-errors
    if($LASTEXITCODE -ne 0){throw 'Cosmos assignment cleanup failed'}
  }
}
if($role){
  az role definition delete --name $m.roleDefinitionId.Split('/')[-1] --subscription $expectedSub --only-show-errors
  if($LASTEXITCODE -ne 0){throw 'Custom role cleanup failed'}
}
if($identity){
  az identity delete --ids $m.identityId --subscription $expectedSub --only-show-errors
  if($LASTEXITCODE -ne 0){throw 'Identity cleanup failed'}
}
foreach($id in $m.assignments){if(Read-Arm $id '2022-04-01'){throw 'A temporary assignment remains'}}
foreach($assignment in $m.cosmosAssignments){if(Read-Arm $assignment.id '2024-05-15'){throw 'A temporary Cosmos assignment remains'}}
if(Read-Arm $m.roleDefinitionId '2022-04-01'){throw 'Temporary role remains'}
if(Read-Arm $m.identityId '2023-01-31'){throw 'Temporary identity remains'}
$m.cleanupCompleted=$true;$m.cleanedUpAt=[DateTimeOffset]::UtcNow.ToString('o');Save
Write-Output "$($m.environment): temporary pod, service account, ARM/Cosmos grants, custom role, identity and federation removed"
