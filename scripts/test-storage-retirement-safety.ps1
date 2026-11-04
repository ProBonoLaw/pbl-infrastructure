# Offline integration checks. Azure and kubectl are replaced by in-memory fakes.
$ErrorActionPreference='Stop'
function Assert-True($Condition,[string]$Message){if(!$Condition){throw $Message}}
function Get-Option([string[]]$Arguments,[string]$Name){
  $index=[Array]::IndexOf($Arguments,$Name)
  if($index -lt 0){throw "Missing fake command argument: $Name"}
  return $Arguments[$index+1]
}
$global:RetirementTestState=@{resources=@{};pods=@{};commands=[Collections.Generic.List[string]]::new();mode='access';fail='';writes=0;cron=0;saves=0}
function az {
  $Arguments=@($args)
  $global:LASTEXITCODE=0
  $state=$global:RetirementTestState
  $command=$Arguments -join ' '
  if($command -like 'account get-access-token *'){return 'offline-test-token'}
  $subscription=Get-Option $Arguments '--subscription'
  $root="/subscriptions/$subscription"
  switch -Wildcard ($command){
    'identity create *' {
      $name=Get-Option $Arguments '-n'
      $id="$root/resourceGroups/shared-storage-northcentral/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$name"
      $value=@{id=$id;clientId='client';principalId='principal';properties=@{principalId='principal'}}
      $state.resources[$id]=$value
    }
    'aks show *' {$value=@{oidcIssuerProfile=@{issuerUrl='https://offline.example/issuer'}}}
    'identity federated-credential create *' {$value=@{}}
    'role definition create *' {
      $role=Get-Content -LiteralPath (Get-Option $Arguments '--role-definition') -Raw|ConvertFrom-Json
      $id="$root/providers/Microsoft.Authorization/roleDefinitions/11111111-1111-1111-1111-111111111111"
      $value=@{id=$id;properties=@{type='CustomRole';roleName=$role.Name}}
      $state.resources[$id]=$value
    }
    'role definition list *' {
      $value=@{id="$root/providers/Microsoft.Authorization/roleDefinitions/22222222-2222-2222-2222-222222222222";roleName='Video Indexer Access Token Generator';permissions=@(@{actions=@('Microsoft.VideoIndexer/accounts/read','Microsoft.VideoIndexer/accounts/generateAccessToken/action')})}
    }
    'role assignment create *' {
      $scope=Get-Option $Arguments '--scope';$name=Get-Option $Arguments '--name'
      $id="$scope/providers/Microsoft.Authorization/roleAssignments/$name"
      $value=@{id=$id;properties=@{principalId=(Get-Option $Arguments '--assignee-object-id');scope=$scope;roleDefinitionId=(Get-Option $Arguments '--role')}}
      $state.resources[$id]=$value
    }
    'cosmosdb sql role assignment create *' {
      $account=Get-Option $Arguments '--account-name';$name=Get-Option $Arguments '--role-assignment-id'
      $id="$root/resourceGroups/shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/$account/sqlRoleAssignments/$name"
      $value=@{id=$id;properties=@{principalId=(Get-Option $Arguments '--principal-id');scope=(Get-Option $Arguments '--scope');roleDefinitionId=(Get-Option $Arguments '--role-definition-id')}}
      $state.resources[$id]=$value
    }
    'cosmosdb sql role assignment delete *' {
      $account=Get-Option $Arguments '--account-name';$name=Get-Option $Arguments '--role-assignment-id'
      $state.resources.Remove("$root/resourceGroups/shared-dbs/providers/Microsoft.DocumentDB/databaseAccounts/$account/sqlRoleAssignments/$name")
      return
    }
    'role definition delete *' {
      $state.resources.Remove("$root/providers/Microsoft.Authorization/roleDefinitions/$(Get-Option $Arguments '--name')")
      return
    }
    'identity delete *' {$state.resources.Remove((Get-Option $Arguments '--ids'));return}
    default {throw "Unexpected Azure call in offline test: $command"}
  }
  return $value|ConvertTo-Json -Depth 18 -Compress
}
function kubectl {
  $Arguments=@($args)
  $state=$global:RetirementTestState
  $command=$Arguments -join ' '
  $state.commands.Add($command)
  $global:LASTEXITCODE=0
  if($state.mode -eq 'rollback'){
    if($state.fail -and $state.fail -in $Arguments){$global:LASTEXITCODE=1}
    return
  }
  switch -Wildcard ($command){
    '* get pods *' {return @{items=@(@{status=@{containerStatuses=@(@{name='functions';imageID=('docker-pullable://offline.example/service@sha256:'+'a'*64)})}})}|ConvertTo-Json -Depth 10 -Compress}
    '* apply *' {
      $manifest=Get-Content -LiteralPath (Get-Option $Arguments '-f') -Raw|ConvertFrom-Json -AsHashtable
      $pod=$manifest.items|Where-Object kind -eq 'Pod'
      $state.pods[$pod.metadata.name]=$pod
    }
    '* get pod *' {
      $name=$Arguments[[Array]::IndexOf($Arguments,'pod')+1]
      if($state.pods.ContainsKey($name)){return $state.pods[$name]|ConvertTo-Json -Depth 18 -Compress}
    }
    '* delete pod *' {$state.pods.Remove($Arguments[[Array]::IndexOf($Arguments,'pod')+1])}
    '* delete serviceaccount *' {}
    '* wait *' {}
    '* exec *' {}
    default {throw "Unexpected kubectl call in offline test: $command"}
  }
}
function Invoke-RestMethod([string]$Uri,[string]$Method='Get',$Headers){
  $id=([uri]$Uri).AbsolutePath
  if($Method -eq 'Delete'){$global:RetirementTestState.resources.Remove($id);return}
  return $global:RetirementTestState.resources[$id]
}

$originalTemp=$env:TEMP
$originalProfile=$env:USERPROFILE
$originalPath=$env:PATH
$scratch=Join-Path ([IO.Path]::GetTempPath()) ('retirement-safety-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($scratch)
try{
  $env:TEMP=$scratch
  if(!$env:USERPROFILE){$env:USERPROFILE=$scratch}
  foreach($environment in @('test','prod')){
    $state=$global:RetirementTestState
    $state.resources=@{};$state.pods=@{}
    & (Join-Path $PSScriptRoot 'start-storage-retirement-access.ps1') -Environment $environment
    $recordPath=Join-Path $scratch "probonolaw-retirement-access-$environment.json"
    $first=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json -AsHashtable
    $expected=if($environment -eq 'test'){9}else{13}
    Assert-True ($first.ready -and $first.assignments.Count -eq $expected -and $first.cosmosAssignments.Count -eq 2) 'Setup failed to journal the complete grant inventory'
    Assert-True (@($state.resources.Values|Where-Object {$_.properties.scope -like '*/resourceGroups/video-indexer'}).Count -eq 1) 'Video Indexer token grant was not provisioned'
    & (Join-Path $PSScriptRoot 'start-storage-retirement-access.ps1') -Environment $environment -Resume
    $resumed=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json -AsHashtable
    Assert-True ($resumed.assignments.Count -eq $expected -and $resumed.cosmosAssignments.Count -eq 2 -and $state.resources.Count -eq $expected+4) 'Resume created duplicate or unjournaled grants'
    $completion=Join-Path $scratch 'complete.json'
    @{environment=$environment;runtimeVerified=$true;oldStorageDeleted=$true;videoLibraryVerified=$true}|ConvertTo-Json|Set-Content -LiteralPath $completion
    $invalid=$resumed.Clone();$invalid.cosmosAssignments=@()
    $invalid|ConvertTo-Json -Depth 18|Set-Content -LiteralPath $recordPath
    $rejected=$false
    try{& (Join-Path $PSScriptRoot 'cleanup-storage-retirement.ps1') -MigrationRecord $recordPath -CompletionRecord $completion}catch{$rejected=$true}
    Assert-True ($rejected -and $state.resources.Count -eq $expected+4 -and $state.pods.Count -eq 1) 'Incomplete journal should block cleanup before deletion'
    $resumed|ConvertTo-Json -Depth 18|Set-Content -LiteralPath $recordPath
    & (Join-Path $PSScriptRoot 'cleanup-storage-retirement.ps1') -MigrationRecord $recordPath -CompletionRecord $completion
    $cleaned=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
    Assert-True ($cleaned.cleanupCompleted -and $state.resources.Count -eq 0 -and $state.pods.Count -eq 0) 'Cleanup left temporary access behind'
  }

  # Execute the real cutover finally block without running the live cutover.
  $tokens=$null;$errors=$null
  $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'invoke-video-indexer-cutover.ps1'),[ref]$tokens,[ref]$errors)
  $try=$ast.Find({param($node) $node -is [System.Management.Automation.Language.TryStatementAst] -and $null -ne $node.Finally},$true)
  $rollback=[scriptblock]::Create(($try.Finally.Statements.Extent.Text -join "`n"))
  function Save{$global:RetirementTestState.saves++}
  function Write-Settings($Values){$global:RetirementTestState.writes++;return @{id='https://offline/secret/version'}}
  function Set-Cron($Suspended){$global:RetirementTestState.cron++}
  $context='offline';$namespace='file-operations';$values=@{}
  $deployments=@(@{name='data-integrity-api';replicas=2},@{name='worker';replicas=1})
  foreach($failure in @('scale','wait','')){
    $state=$global:RetirementTestState
    $state.mode='rollback';$state.fail=$failure;$state.writes=0;$state.cron=0;$state.commands.Clear()
    $record=@{cutover=$true;runtimeVerified=$false;cronWasSuspended=$false;restored=$false}
    $rejected=$false
    try{& $rollback}catch{$rejected=$true}
    if($failure){
      Assert-True ($rejected -and $record.rollbackBlocked -and $state.writes -eq 0 -and $state.cron -eq 0 -and !$record.restored) 'Failed rollback resumed workloads or changed settings'
      Assert-True ($state.commands.Count -eq $(if($failure -eq 'scale'){1}else{2})) 'Rollback continued after a failed stop command'
    }else{
      Assert-True (!$rejected -and $state.writes -eq 1 -and $state.cron -eq 1 -and $record.restored) 'Verified pod termination should allow settings restoration'
    }
  }
  'Passed Test/Production setup, resume and cleanup, incomplete-journal rejection, and rollback failure checks'
}finally{
  $env:TEMP=$originalTemp
  $env:USERPROFILE=$originalProfile
  $env:PATH=$originalPath
  # Only this test's uniquely created directory can be removed.
  $resolved=[IO.Path]::GetFullPath($scratch)
  $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if(!$resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'retirement-safety-*'){throw 'Unexpected test cleanup path'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
  Remove-Variable RetirementTestState -Scope Global
}
