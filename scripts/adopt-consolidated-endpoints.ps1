param(
    [Parameter(Mandatory)][ValidateSet('test','prod')][string]$Environment,
    [Parameter(Mandatory)][string]$Journal,
    [Parameter(Mandatory)][string]$BeforeState,
    [string]$Pulumi = 'C:\ProgramData\chocolatey\lib\pulumi\tools\pulumi\bin\pulumi.exe'
)
$ErrorActionPreference='Stop'
if (-not $env:PULUMI_CONFIG_PASSPHRASE) { throw 'Set PULUMI_CONFIG_PASSPHRASE in the process environment' }
$migration=Get-Content -LiteralPath $Journal -Raw | ConvertFrom-Json
if($migration.environment -ne $Environment -or -not $migration.dnsProbePassed -or @($migration.endpoints | Where-Object {-not $_.retired}).Count) { throw 'Complete and verify endpoint migration first' }
$state=Get-Content -LiteralPath $BeforeState -Raw | ConvertFrom-Json
$oldIds=@($migration.endpoints.old.id)+@($migration.endpoints.oldZoneGroup.id)
$targets=@($state.deployment.resources | Where-Object {$_.id -in $oldIds})
if($targets.Count -ne 18) { throw "Expected 18 previously managed endpoint resources, found $($targets.Count)" }
$env:AZURE_STORAGE_ACCOUNT='pbldeployments'
$env:PULUMI_BACKEND_URL="azblob://$Environment"
$arguments=@('refresh','--stack',$Environment,'--yes','--skip-preview','--json')
foreach($target in $targets) { $arguments+=@('--target',$target.urn) }
$refreshLog=Join-Path $env:TEMP "probonolaw-network-refresh-$Environment-20261028.json"
& $Pulumi @arguments > $refreshLog
if($LASTEXITCODE -ne 0) { throw "Endpoint state refresh failed; see $refreshLog" }
$imports=@()
foreach($entry in $migration.endpoints) {
    $imports+=@{type='azure-native:network:PrivateEndpoint';name=$entry.logical;id=$entry.newId}
    $imports+=@{type='azure-native:network:PrivateDnsZoneGroup';name="$($entry.logical)-dns";id="$($entry.newId)/privateDnsZoneGroups/default"}
}
$importFile=Join-Path $env:TEMP "probonolaw-network-import-$Environment-20261028.json"
[IO.File]::WriteAllText($importFile,(@{resources=$imports}|ConvertTo-Json -Depth 8))
$importLog=Join-Path $env:TEMP "probonolaw-network-import-log-$Environment-20261028.json"
& $Pulumi import --stack $Environment --file $importFile --generate-code=false --protect=false --yes --json > $importLog
if($LASTEXITCODE -ne 0) { throw "Endpoint import failed; see $importLog" }
Write-Output "$Environment`: adopted 10 private endpoints and 10 DNS zone groups"
