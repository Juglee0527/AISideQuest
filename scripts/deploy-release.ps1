param(
  [Parameter(Mandatory = $true)][ValidateSet('staging', 'production')][string]$Environment,
  [Parameter(Mandatory = $true)][string]$EnvironmentFile,
  [Parameter(Mandatory = $true)][string]$PublicOrigin,
  [Parameter(Mandatory = $true)][string]$BackupEvidence,
  [string]$RestoreDrillEvidence
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$composeFile = Join-Path $workspaceRoot 'deploy/compose.deploy.yaml'
$environmentPath = [IO.Path]::GetFullPath($EnvironmentFile)
$backupPath = [IO.Path]::GetFullPath($BackupEvidence)

function Read-EnvironmentFile([string]$Path) {
  $result = @{}
  foreach ($sourceLine in Get-Content -LiteralPath $Path) {
    $line = $sourceLine.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { throw "invalid environment line in $Path" }
    $result[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
  }
  return $result
}

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) { throw 'environment file does not exist' }
if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf) -or (Get-Item -LiteralPath $backupPath).Length -eq 0) {
  throw 'a non-empty backup evidence file is required before deployment'
}
$backupAge = [DateTime]::UtcNow - (Get-Item -LiteralPath $backupPath).LastWriteTimeUtc
if ($backupAge.TotalHours -gt 24) { throw 'backup evidence is older than the 24-hour RPO target' }
if ($Environment -eq 'production') {
  if ([string]::IsNullOrWhiteSpace($RestoreDrillEvidence)) { throw 'production deployment requires restore drill evidence' }
  $restorePath = [IO.Path]::GetFullPath($RestoreDrillEvidence)
  if (-not (Test-Path -LiteralPath $restorePath -PathType Leaf) -or (Get-Item -LiteralPath $restorePath).Length -eq 0) {
    throw 'restore drill evidence must be a non-empty file'
  }
  $restoreAge = [DateTime]::UtcNow - (Get-Item -LiteralPath $restorePath).LastWriteTimeUtc
  if ($restoreAge.TotalDays -gt 30) { throw 'restore drill evidence is older than 30 days' }
}

node (Join-Path $workspaceRoot 'scripts/validate-deployment-env.mjs') $Environment $environmentPath
if ($LASTEXITCODE -ne 0) { throw 'deployment environment validation failed' }

$configuration = Read-EnvironmentFile $environmentPath
$env:DEPLOYMENT_ENVIRONMENT = $Environment
$env:AISIDEQUEST_ENV_FILE = $environmentPath
$env:AISIDEQUEST_API_IMAGE = $configuration.AISIDEQUEST_API_IMAGE
$env:AISIDEQUEST_WEB_IMAGE = $configuration.AISIDEQUEST_WEB_IMAGE
$env:SITE_ADDRESS = $configuration.SITE_ADDRESS

$stateDirectory = Join-Path $workspaceRoot 'ops/release-state'
$statePath = Join-Path $stateDirectory "$Environment.json"
$previousState = $null
if (Test-Path -LiteralPath $statePath) {
  $previousState = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
}

docker compose -f $composeFile config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration is invalid' }
docker compose -f $composeFile pull api web migrate
if ($LASTEXITCODE -ne 0) { throw 'image pull failed; no services were changed' }

docker compose -f $composeFile --profile operations run --rm migrate
if ($LASTEXITCODE -ne 0) { throw 'migration failed; no application service was changed—forward-fix the migration before retrying' }

docker compose -f $composeFile up -d --wait api
if ($LASTEXITCODE -ne 0) { throw 'API did not become ready; stop rollout and inspect request-id logs' }
docker compose -f $composeFile up -d --wait web
if ($LASTEXITCODE -ne 0) { throw 'web service did not start; use rollback-release.ps1 for an app-only rollback' }

node (Join-Path $workspaceRoot 'scripts/smoke-deployment.mjs') $PublicOrigin
if ($LASTEXITCODE -ne 0) { throw 'live smoke failed; use rollback-release.ps1 and keep the database at its current migration level' }

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
$current = [PSCustomObject]@{
  serviceVersion = $configuration.SERVICE_VERSION
  apiImage = $configuration.AISIDEQUEST_API_IMAGE
  webImage = $configuration.AISIDEQUEST_WEB_IMAGE
  deployedAt = [DateTime]::UtcNow.ToString('o')
}
[PSCustomObject]@{
  environment = $Environment
  current = $current
  previous = if ($null -eq $previousState) { $null } else { $previousState.current }
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath $statePath

Write-Output "deployment passed migration, readiness, HTTPS/CORS/OAuth, and SPA smoke checks for $Environment"
