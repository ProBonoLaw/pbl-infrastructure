param([Parameter(Mandatory)][ValidateSet('test','prod')][string]$Environment)
$ErrorActionPreference='Stop'
function AzJson([string[]]$Arguments) {
  $value=& az @Arguments --only-show-errors -o json
  if($LASTEXITCODE -ne 0){throw "Azure operation failed: $($Arguments[0..1] -join ' ')"}
  if($value){$value | ConvertFrom-Json}
}
$test=$Environment -eq 'test'
$sub=if($test){'00000000-0000-4000-8000-000000000003'}else{'00000000-0000-4000-8000-000000000002'}
$suffix=if($test){'testsuffix001'}else{'prodsuffix001'}
$storage=if($test){'probonolawdatatestsuffix'}else{'probonolawdataprodsuffix'}
$name="video-indexer-v2-$suffix"
$group='video-indexer'
$root="/subscriptions/$sub/resourceGroups/$group"
$id="$root/providers/Microsoft.VideoIndexer/accounts/$name"
$recordPath=Join-Path $env:TEMP "probonolaw-video-indexer-replacement-$Environment.json"
if(Test-Path -LiteralPath $recordPath){throw 'Replacement record already exists; inspect and resume completed stages explicitly'}
$existing=AzJson @('resource','list','--subscription',$sub,'-g',$group,'--resource-type','Microsoft.VideoIndexer/accounts','--name',$name)
if(@($existing).Count){throw 'Replacement name already exists'}
$record=[ordered]@{environment=$Environment;subscription=$sub;name=$name;id=$id;location='eastus';storage=$storage;createdAt=[DateTimeOffset]::UtcNow.ToString('o');persistentAssignments=@();ready=$false}
function Save{$record | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $recordPath -Encoding utf8}
Save
$identity=AzJson @('identity','create','--subscription',$sub,'-g',$group,'-n',"$name-identity",'--location','eastus','--tags','Purpose=StorageConsolidation')
$record.identityId=$identity.id;$record.clientId=$identity.clientId;$record.principalId=$identity.principalId;Save
$storageId="/subscriptions/$sub/resourceGroups/shared-storage-northcentral/providers/Microsoft.Storage/storageAccounts/$storage"
$grant=AzJson @('role','assignment','create','--subscription',$sub,'--assignee-object-id',$identity.principalId,'--assignee-principal-type','ServicePrincipal','--role','Storage Blob Data Contributor','--scope',$storageId)
$record.storageAssignmentId=$grant.id;$record.persistentAssignments+=@($grant.id);Save
$identities=@{};$identities[$identity.id]=@{}
$body=@{location='eastus';tags=@{Environment=if($test){'Test'}else{'Production'};Purpose='StorageConsolidation'};identity=@{type='UserAssigned';userAssignedIdentities=$identities};properties=@{publicNetworkAccess='Disabled';storageServices=@{resourceId=$storageId;userAssignedIdentity=$identity.id}}}
$bodyPath=Join-Path $env:TEMP "$name-create.json"
$body | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $bodyPath -Encoding utf8
$account=AzJson @('rest','--method','put','--url',"https://management.azure.com${id}?api-version=2025-04-01",'--body',"@$bodyPath")
for($i=0;$i -lt 60;$i++) {
  if($account.properties.provisioningState -eq 'Succeeded'){break}
  if($account.properties.provisioningState -eq 'Failed'){throw 'VI provisioning failed'}
  Start-Sleep -Seconds 5
  $account=AzJson @('resource','show','--ids',$id,'--api-version','2025-04-01')
}
if($account.properties.provisioningState -ne 'Succeeded' -or $account.properties.storageServices.resourceId -ne $storageId){throw 'Replacement storage binding not verified'}
$record.accountId=$account.properties.accountId;Save
$subnet="/subscriptions/$sub/resourceGroups/shared-vnet-aks-northcentral/providers/Microsoft.Network/virtualNetworks/aks-northcentral/subnets/private-endpoints"
$endpoint=AzJson @('network','private-endpoint','create','--subscription',$sub,'-g',$group,'-n',"$name-pe",'--location','northcentralus','--subnet',$subnet,'--private-connection-resource-id',$id,'--group-id','account','--connection-name',"$name-pe")
$record.endpointId=$endpoint.id;Save
$zone="/subscriptions/$sub/resourceGroups/data-ingestion-logic-apps-dns-zones/providers/Microsoft.Network/privateDnsZones/privatelink.api.videoindexer.ai"
$dns=AzJson @('network','private-endpoint','dns-zone-group','create','--subscription',$sub,'-g',$group,'--endpoint-name',"$name-pe",'-n','default','--private-dns-zone',$zone,'--zone-name','privatelink.api.videoindexer.ai')
$record.dnsGroupId=$dns.id;Save
$roleId=if($test){'00000000-0000-4000-8000-00000000000e'}else{'00000000-0000-4000-8000-00000000000f'}
$workload=AzJson @('identity','show','--subscription',$sub,'-g',$(if($test){'probono-law-aks-prototype'}else{'probono-law-aks-production'}),'-n',$(if($test){'file-operations-test-workload'}else{'file-operations-prod-workload'}))
$grant=AzJson @('role','assignment','create','--subscription',$sub,'--assignee-object-id',$workload.principalId,'--assignee-principal-type','ServicePrincipal','--role',$roleId,'--scope',$id)
$record.workloadAssignmentId=$grant.id;$record.workloadPrincipalId=$workload.principalId;$record.persistentAssignments+=@($grant.id);Save
$record.ready=$true;Save
Write-Output "$Environment replacement provisioned: $name ($($record.accountId))"
