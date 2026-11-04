param([Parameter(Mandatory)][ValidateSet('test','prod')][string]$Environment, [switch]$Resume)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'storage-retirement-grants.ps1')
$env:PATH=(Join-Path $env:USERPROFILE '.azure-kubelogin')+';'+$env:PATH
function Invoke-AzJson([string[]]$Arguments) {
  $result = & az @Arguments --only-show-errors -o json
  if ($LASTEXITCODE -ne 0) { throw "Azure command failed: $($Arguments[0..1] -join ' ')" }
  if ($result) { $result | ConvertFrom-Json }
}
$subscription = if ($Environment -eq 'test') {'00000000-0000-4000-8000-000000000003'} else {'00000000-0000-4000-8000-000000000002'}
$context = if ($Environment -eq 'test') {'probono-law-aks-test-nc'} else {'probono-law-aks-prod'}
$clusterGroup = if ($Environment -eq 'test') {'probono-law-aks-test-northcentral'} else {'probono-law-aks-production'}
$clusterName = if ($Environment -eq 'test') {'probono-law-aks-test-nc'} else {'probono-law-aks-prod'}
$suffix=[guid]::NewGuid().ToString('N').Substring(0,8)
$name="storage-retirement-$suffix"
$recordPath=Join-Path $env:TEMP "probonolaw-retirement-access-$Environment.json"
if ((Test-Path $recordPath) -and !$Resume) { throw 'Existing migration access record; inspect before creating more access' }
$record=[ordered]@{environment=$Environment;subscription=$subscription;context=$context;group='shared-storage-northcentral';name=$name;namespace='aimie-operations';assignments=@();cosmosAssignments=@();createdAt=[datetime]::UtcNow.ToString('o');cleanupCompleted=$false;ready=$false}
function Save-Record { $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $recordPath }
if (!$Resume) {
Save-Record
$identity=Invoke-AzJson @('identity','create','--subscription',$subscription,'-g',$record.group,'-n',$name,'--location','northcentralus','--tags','Purpose=TemporaryStorageRetirement')
$record.identityId=$identity.id; $record.clientId=$identity.clientId; $record.principalId=$identity.principalId; Save-Record
$cluster=Invoke-AzJson @('aks','show','--subscription',$subscription,'-g',$clusterGroup,'-n',$clusterName)
$issuer=$cluster.oidcIssuerProfile.issuerUrl
if (-not $issuer) { throw 'No AKS OIDC issuer' }
$null=Invoke-AzJson @('identity','federated-credential','create','--subscription',$subscription,'-g',$record.group,'--identity-name',$name,'-n','migration','--issuer',$issuer,'--subject',"system:serviceaccount:aimie-operations:$name",'--audiences','api://AzureADTokenExchange')
$roleId=[guid]::NewGuid().ToString()
$role=[ordered]@{Name="Storage retirement source reader $suffix";IsCustom=$true;Description='Temporary read-only migration access, including blob tags and queue inspection';Actions=@('Microsoft.Storage/storageAccounts/blobServices/containers/read','Microsoft.Storage/storageAccounts/queueServices/queues/read','Microsoft.Storage/storageAccounts/tableServices/tables/read');NotActions=@();DataActions=@('Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read','Microsoft.Storage/storageAccounts/blobServices/containers/blobs/tags/read','Microsoft.Storage/storageAccounts/queueServices/queues/messages/read','Microsoft.Storage/storageAccounts/tableServices/tables/entities/read');NotDataActions=@();AssignableScopes=@("/subscriptions/$subscription")}
$roleFile=Join-Path $env:TEMP "$name-role.json"
$role | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $roleFile
$definition=Invoke-AzJson @('role','definition','create','--subscription',$subscription,'--role-definition',$roleFile)
$record.roleDefinitionId=$definition.id; Save-Record
} else {
  $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json -AsHashtable
  if($record.environment -ne $Environment -or $record.subscription -ne $subscription -or $record.cleanupCompleted){throw 'Active matching retirement record required to resume'}
  $record.ready=$false
  if(!$record.Contains('cosmosAssignments')){$record.cosmosAssignments=@()}
  $name=$record.name
  $identity=@{clientId=$record.clientId;principalId=$record.principalId}
}
$tokenRoles=@(Invoke-AzJson @('role','definition','list','--subscription',$subscription) | Where-Object {
  $_.roleName -like 'Video Indexer Access Token Generator*' -and
  'Microsoft.VideoIndexer/accounts/read' -in $_.permissions.actions -and
  'Microsoft.VideoIndexer/accounts/generateAccessToken/action' -in $_.permissions.actions
})
if($tokenRoles.Count -ne 1){throw 'Exactly one existing Video Indexer token-generator role is required'}
$record.videoIndexerRoleDefinitionId=$tokenRoles[0].id;Save-Record
$plan=Get-RetirementGrantPlan $Environment $record.roleDefinitionId $record.videoIndexerRoleDefinitionId
foreach($entry in $plan.arm){
  $assignmentName=Get-RetirementAssignmentName $record.principalId $entry.scope $entry.role
  $assignmentId="$($entry.scope)/providers/Microsoft.Authorization/roleAssignments/$assignmentName"
  if($assignmentId -notin $record.assignments){
    $record.assignments+= $assignmentId;Save-Record
  }
  $grant=Invoke-AzJson @('role','assignment','create','--subscription',$subscription,'--name',$assignmentName,'--assignee-object-id',$identity.principalId,'--assignee-principal-type','ServicePrincipal','--role',$entry.role,'--scope',$entry.scope)
  if($grant.id -ne $assignmentId){throw 'Unexpected ARM assignment ID'}
}
foreach($entry in $plan.cosmos){
  $assignmentName=Get-RetirementAssignmentName $record.principalId $entry.scope $entry.role
  $assignmentId="$($entry.accountId)/sqlRoleAssignments/$assignmentName"
  if($assignmentId -notin $record.cosmosAssignments.id){
    $record.cosmosAssignments+=@{id=$assignmentId;account=$entry.account};Save-Record
  }
  $grant=Invoke-AzJson @('cosmosdb','sql','role','assignment','create','--subscription',$subscription,'-g','shared-dbs','--account-name',$entry.account,'--role-assignment-id',$assignmentName,'--principal-id',$identity.principalId,'--role-definition-id',$entry.role,'--scope',$entry.scope)
  if($grant.id -ne $assignmentId){throw 'Unexpected Cosmos assignment ID'}
}
$serviceAccount=@{apiVersion='v1';kind='ServiceAccount';metadata=@{name=$name;namespace='aimie-operations';annotations=@{'azure.workload.identity/client-id'=$identity.clientId}}}
$pod=@{
  apiVersion='v1';kind='Pod'
  metadata=@{labels=@{'azure.workload.identity/use'='true'}}
  spec=@{
    restartPolicy='Never'
    containers=@(@{securityContext=@{readOnlyRootFilesystem=$true;allowPrivilegeEscalation=$false;runAsNonRoot=$true;runAsUser=10001;capabilities=@{drop=@('ALL')}}})
  }
}
$livePods= & kubectl --context $context -n aimie-operations get pods -l app=aimie-service -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or !$livePods.items) { throw 'No reference AIMIE pod found' }
$image=($livePods.items[0].status.containerStatuses | Where-Object name -eq 'functions').imageID -replace '^docker-pullable://',''
if ($image -notmatch '@sha256:') { throw 'Reference image is not digest-pinned' }
$pod.metadata.name=$name; $pod.metadata.namespace='aimie-operations'; $pod.metadata.labels.app='storage-migration'
$pod.spec.serviceAccountName=$name; $pod.spec.activeDeadlineSeconds=43200
$pod.spec.containers[0].name='migration'; $pod.spec.containers[0].image=$image
$pod.spec.containers[0].command=@('python','-c','import time; time.sleep(43200)')
$pod.spec.containers[0].resources=@{requests=@{cpu='100m';memory='256Mi'};limits=@{cpu='2';memory='2Gi'}}
$pod.spec.containers[0].volumeMounts=@(@{name='work';mountPath='/work'},@{name='temp';mountPath='/tmp'})
$pod.spec.volumes=@(@{name='work';emptyDir=@{sizeLimit='8Gi'}},@{name='temp';emptyDir=@{sizeLimit='2Gi'}})
$manifest=@{apiVersion='v1';kind='List';items=@($serviceAccount,$pod)}
$manifestFile=Join-Path $env:TEMP "$name-pod.json"
$manifest | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $manifestFile
& kubectl --context $context apply -f $manifestFile
if ($LASTEXITCODE -ne 0) { throw 'Migration pod creation failed' }
$record.manifest=$manifestFile; Save-Record
& kubectl --context $context -n aimie-operations wait --for=condition=Ready "pod/$name" --timeout=90s
if ($LASTEXITCODE -ne 0) { throw 'Migration pod not ready' }
& kubectl --context $context -n aimie-operations exec $name -- python -m pip install --quiet --disable-pip-version-check --upgrade --no-cache-dir --target /work/python 'azure-identity>=1.20,<2' 'azure-storage-blob>=12.25,<13' 'azure-data-tables>=12.6,<13' 'azure-storage-queue>=12.12,<13' 'azure-storage-file-share>=12.20,<13' 'azure-cosmos>=4.9,<5'
if ($LASTEXITCODE -ne 0) { throw 'Migration SDK installation failed' }
$record.ready=$true; Save-Record
Write-Output "Migration identity and pod ready: $Environment $name; record $recordPath"
