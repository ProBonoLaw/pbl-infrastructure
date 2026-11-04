param(
    [Parameter(Mandatory = $true)][ValidateSet('test', 'prod')][string]$Stack,
    [string]$ApiNamespace = 'probonolaw-ui',
    [string]$AcmeEmail = 'info@probono-law.com',
    [string]$OutputPath = 'portal-api-bootstrap.yaml'
)

$ErrorActionPreference = 'Stop'
$stackOutputs = pulumi stack output --stack $Stack --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Unable to read Pulumi $Stack outputs" }
$ipName = [string]$stackOutputs.portalApiPublicIpName
$origin = [string]$stackOutputs.portalApiOriginHostname
if (-not $ipName -or -not $origin) { throw 'Apply the portal delivery resources before rendering the bootstrap manifest' }
$aksGroup = if ($Stack -eq 'test') { 'probono-law-aks-test-northcentral' } else { 'probono-law-aks-production' }

foreach ($value in @($ipName, $aksGroup, $ApiNamespace)) {
    if ($value.Length -gt 63 -or $value -cnotmatch '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$') {
        throw 'IP resource name, resource group, and Kubernetes namespace must be DNS labels of at most 63 characters'
    }
}
if ($origin.Length -gt 253 -or $origin -cnotmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$') {
    throw 'API origin hostname must be a DNS name'
}
if ($AcmeEmail -cnotmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') {
    throw 'ACME email must be a valid address'
}

$templatePath = Join-Path $PSScriptRoot '..\deploy\portal-api-bootstrap.yaml.template'
$manifest = [IO.File]::ReadAllText($templatePath)
$manifest = $manifest.Replace('${PUBLIC_IP_NAME}', $ipName)
$manifest = $manifest.Replace('${AKS_RESOURCE_GROUP}', $aksGroup)
$manifest = $manifest.Replace('${API_NAMESPACE}', $ApiNamespace)
$manifest = $manifest.Replace('${ACME_EMAIL}', $AcmeEmail)
$manifest = $manifest.Replace('${API_ORIGIN_HOSTNAME}', $origin)
$resolvedOutputPath = if ([IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path (Get-Location) $OutputPath
}
[IO.File]::WriteAllText($resolvedOutputPath, $manifest)
Write-Host "Wrote $OutputPath for $Stack ($origin)"
