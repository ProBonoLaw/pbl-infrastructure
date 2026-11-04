# Shared setup/cleanup contract for temporary grants. No Azure calls here.
function Get-RetirementGrantPlan([string]$Environment, [string]$SourceReaderRole, [string]$VideoIndexerRole) {
  if($Environment -notin @('test','prod')){throw 'Unknown retirement environment'}
  $subscription=if($Environment -eq 'test'){'00000000-0000-4000-8000-000000000003'}else{'00000000-0000-4000-8000-000000000002'}
  $root="/subscriptions/$subscription"
  $sourceGroups=@('aimie-config','aimie-service','aimie-data-automation','integrity-cache','probonolaw-portal')
  if($Environment -eq 'prod'){$sourceGroups+=@('data-ingestion-svc','data-integrity-extractor','portal-starter','resource-manager')}
  $arm=@($sourceGroups | ForEach-Object {@{scope="$root/resourceGroups/$_";role=$SourceReaderRole}})
  foreach($role in @('b7e6dc6d-f1e8-4753-8033-0f276bb0955b','974c5e8b-45b9-4653-ba55-5f855dd0fb88','0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')){
    $arm+=@{scope="$root/resourceGroups/shared-storage-northcentral";role="$root/providers/Microsoft.Authorization/roleDefinitions/$role"}
  }
  $arm+=@{scope="$root/resourceGroups/video-indexer";role=$VideoIndexerRole}
  $suffix=if($Environment -eq 'test'){'testsuffix001'}else{'prodsuffix001'}
  $account="db-law-sls-$suffix"
  $accountId="$root/resourceGroups/shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/$account"
  $cosmos=@(
    @{account=$account;accountId=$accountId;scope=$accountId;role="$accountId/sqlRoleDefinitions/00000000-0000-4000-8000-000000000010"},
    @{account=$account;accountId=$accountId;scope="$accountId/dbs/db_conversation_history/colls/feedback";role="$accountId/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"}
  )
  return @{subscription=$subscription;arm=$arm;cosmos=$cosmos}
}

function Get-RetirementAssignmentName([string]$PrincipalId, [string]$Scope, [string]$Role) {
  $hash=[Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes("$PrincipalId|$Scope|$Role".ToLowerInvariant()))
  return [guid]::new([byte[]]$hash[0..15]).ToString()
}
