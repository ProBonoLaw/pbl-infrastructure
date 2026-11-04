param(
    [Parameter(Mandatory = $true)][ValidateSet('test', 'prod')][string]$Stack,
    [string]$ApiNamespace = 'probonolaw-ui',
    [string]$ApiServiceName = 'portal-api',
    [string]$OutputPath = 'portal-public-ingress.yaml'
)

$ErrorActionPreference = 'Stop'
$stackOutputs = pulumi stack output --stack $Stack --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Unable to read Pulumi $Stack outputs" }
$ipName = [string]$stackOutputs.portalApiPublicIpName
$origin = [string]$stackOutputs.portalApiOriginHostname
if (-not $ipName -or -not $origin) { throw 'Apply the portal delivery resources before rendering the ingress' }
$aksGroup = if ($Stack -eq 'test') { 'probono-law-aks-test-northcentral' } else { 'probono-law-aks-production' }

foreach ($value in @($ApiNamespace, $ApiServiceName)) {
    if ($value.Length -gt 63 -or $value -cnotmatch '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$') {
        throw 'Kubernetes namespace and service name must be DNS labels of at most 63 characters'
    }
}

$templatePath = Join-Path $PSScriptRoot '..\deploy\portal-public-ingress.yaml.template'
$manifest = [IO.File]::ReadAllText($templatePath)
$manifest = $manifest.Replace('${PUBLIC_IP_NAME}', $ipName)
$manifest = $manifest.Replace('${AKS_RESOURCE_GROUP}', $aksGroup)
$manifest = $manifest.Replace('${API_NAMESPACE}', $ApiNamespace)
$manifest = $manifest.Replace('${API_SERVICE_NAME}', $ApiServiceName)
$manifest = $manifest.Replace('${API_ORIGIN_HOSTNAME}', $origin)
$resolvedOutputPath = if ([IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path (Get-Location) $OutputPath
}
[IO.File]::WriteAllText($resolvedOutputPath, $manifest)
Write-Host "Wrote $OutputPath for $Stack ($origin)"
