param(
  [Parameter(Mandatory = $true)][ValidateSet('staging', 'production')][string]$Environment,
  [Parameter(Mandatory = $true)][string]$EnvironmentFile,
  [Parameter(Mandatory = $true)][string]$PublicOrigin
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$composeFile = Join-Path $workspaceRoot 'deploy/compose.deploy.yaml'
$environmentPath = [IO.Path]::GetFullPath($EnvironmentFile)
$statePath = Join-Path $workspaceRoot "ops/release-state/$Environment.json"

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'release state was not found' }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
if ($null -eq $state.previous) { throw 'no previous digest-pinned application release is recorded' }

$env:DEPLOYMENT_ENVIRONMENT = $Environment
$env:AISIDEQUEST_ENV_FILE = $environmentPath
$env:AISIDEQUEST_API_IMAGE = $state.previous.apiImage
$env:AISIDEQUEST_WEB_IMAGE = $state.previous.webImage
$origin = [Uri]$PublicOrigin
$env:SITE_ADDRESS = $origin.Host

# This is intentionally application-only. Database migrations are forward-fixed,
# never destructively reverted during an incident.
docker compose -f $composeFile up -d --wait api web
if ($LASTEXITCODE -ne 0) { throw 'previous application images did not become healthy' }
node (Join-Path $workspaceRoot 'scripts/smoke-deployment.mjs') $PublicOrigin
if ($LASTEXITCODE -ne 0) { throw 'rollback images failed smoke verification' }

$rolledBack = [PSCustomObject]@{
  environment = $Environment
  current = $state.previous
  previous = $state.current
}
$rolledBack | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath $statePath
Write-Output "application rollback passed smoke checks for $Environment; database schema was not reverted"

