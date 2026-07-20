param(
  [string]$SourceDatabase = 'aisidequest',
  [string]$RestoreDatabase = 'aisidequest_restore_test',
  [switch]$KeepEncryptedBackup
)

$ErrorActionPreference = 'Stop'

if ($RestoreDatabase -notmatch '^[a-z0-9_]*restore_test$') {
  throw 'RestoreDatabase must end with restore_test'
}

$backupPassphrase = $env:BACKUP_ENCRYPTION_PASSPHRASE
if ([string]::IsNullOrWhiteSpace($backupPassphrase) -or $backupPassphrase.Length -lt 16) {
  throw 'BACKUP_ENCRYPTION_PASSPHRASE must contain at least 16 characters'
}

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('aisidequest-backup-' + [guid]::NewGuid().ToString('N'))
$backupDirectory = Join-Path $workspaceRoot 'backups'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$containerDump = "/tmp/aisidequest-$stamp.dump"
$containerRestored = "$containerDump.restored"
$localRaw = Join-Path $temporaryRoot "aisidequest-$stamp.dump"
$localEncrypted = Join-Path $temporaryRoot "aisidequest-$stamp.dump.enc"
$localRestored = Join-Path $temporaryRoot "aisidequest-$stamp.restored"

function Protect-Backup([string]$InputPath, [string]$OutputPath, [string]$Passphrase) {
  $salt = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  $derive = New-Object Security.Cryptography.Rfc2898DeriveBytes($Passphrase, $salt, 100000)
  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256
  $aes.Key = $derive.GetBytes(32)
  $aes.GenerateIV()
  $plain = [IO.File]::ReadAllBytes($InputPath)
  $encryptor = $aes.CreateEncryptor()
  $cipher = $encryptor.TransformFinalBlock($plain, 0, $plain.Length)
  [IO.File]::WriteAllBytes($OutputPath, $salt + $aes.IV + $cipher)
  $encryptor.Dispose(); $aes.Dispose(); $derive.Dispose()
}

function Unprotect-Backup([string]$InputPath, [string]$OutputPath, [string]$Passphrase) {
  $body = [IO.File]::ReadAllBytes($InputPath)
  if ($body.Length -lt 33) { throw 'encrypted backup is truncated' }
  $salt = $body[0..15]
  $iv = $body[16..31]
  $cipher = $body[32..($body.Length - 1)]
  $derive = New-Object Security.Cryptography.Rfc2898DeriveBytes($Passphrase, $salt, 100000)
  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256
  $aes.Key = $derive.GetBytes(32)
  $aes.IV = $iv
  $decryptor = $aes.CreateDecryptor()
  $plain = $decryptor.TransformFinalBlock($cipher, 0, $cipher.Length)
  [IO.File]::WriteAllBytes($OutputPath, $plain)
  $decryptor.Dispose(); $aes.Dispose(); $derive.Dispose()
}

New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

try {
  docker compose exec -T postgres pg_dump -Fc -U aisidequest -d $SourceDatabase -f $containerDump
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }

  $containerId = (docker compose ps -q postgres).Trim()
  if ([string]::IsNullOrWhiteSpace($containerId)) { throw 'postgres container not found' }
  docker cp "${containerId}:${containerDump}" $localRaw
  if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }

  Protect-Backup $localRaw $localEncrypted $backupPassphrase
  Unprotect-Backup $localEncrypted $localRestored $backupPassphrase
  docker cp $localRestored "${containerId}:${containerRestored}"
  if ($LASTEXITCODE -ne 0) { throw 'restored dump copy failed' }

  docker compose exec -T postgres psql -U aisidequest -d postgres -v ON_ERROR_STOP=1 `
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$RestoreDatabase' AND pid <> pg_backend_pid()" `
    -c "DROP DATABASE IF EXISTS $RestoreDatabase" `
    -c "CREATE DATABASE $RestoreDatabase OWNER aisidequest"
  if ($LASTEXITCODE -ne 0) { throw 'restore database creation failed' }

  docker compose exec -T postgres pg_restore -U aisidequest -d $RestoreDatabase --no-owner --no-acl $containerRestored
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed' }

  $verification = docker compose exec -T postgres psql -U aisidequest -d $RestoreDatabase -tAc `
    "SELECT json_build_object('users', (SELECT count(*) FROM users), 'quests', (SELECT count(*) FROM quests), 'migrations', (SELECT count(*) FROM schema_migrations), 'ledger_constraint', to_regclass('public.uk_point_ledger_user_quest_reward') IS NOT NULL)::text"
  if ($LASTEXITCODE -ne 0) { throw 'restore verification query failed' }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $localEncrypted).Hash.ToLowerInvariant()
  [PSCustomObject]@{
    restored = $true
    sourceDatabase = $SourceDatabase
    restoreDatabase = $RestoreDatabase
    encryptedBackupSha256 = $hash
    verification = $verification.Trim()
  } | ConvertTo-Json -Depth 5

  if ($KeepEncryptedBackup) {
    New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
    Copy-Item -LiteralPath $localEncrypted -Destination $backupDirectory
  }
} finally {
  try {
    docker compose exec -T postgres psql -q -U aisidequest -d postgres -v ON_ERROR_STOP=1 `
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$RestoreDatabase' AND pid <> pg_backend_pid()" `
      -c "DROP DATABASE IF EXISTS $RestoreDatabase" 2>$null | Out-Null
  } catch {}
  try { docker compose exec -T postgres rm -f $containerDump $containerRestored 2>$null | Out-Null } catch {}

  $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
  if ($resolvedTemporaryRoot.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}
