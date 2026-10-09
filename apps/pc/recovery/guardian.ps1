param([Parameter(Mandatory=$true)][string]$Transaction)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Transaction
function Phase([string]$Value) { [IO.File]::WriteAllText((Join-Path $Transaction 'phase.tmp'), $Value); Move-Item -LiteralPath 'phase.tmp' -Destination 'phase' -Force }
function Read([string]$Name) { if (Test-Path -LiteralPath $Name) { return [IO.File]::ReadAllText((Join-Path $Transaction $Name)).Trim() }; return '' }
function Healthy([string]$Version) { return ((Read 'healthy') -ceq ($nonce + ':' + $Version)) -or ((Read 'decision') -ceq ('healthy:' + $nonce + ':' + $Version)) }
if ((Read 'phase') -in @('healthy','recovered','failed','cancelled')) { exit 0 }
# An exclusive file handle is released by Windows even if this process crashes.
try { $lock = [IO.File]::Open((Join-Path $Transaction 'guardian.lock'), 'OpenOrCreate', 'ReadWrite', 'None') } catch { exit 0 }
try {
  $nonce = Read 'nonce'; $target = Read 'target'; $previous = Read 'previous'; $timeout = [int](Read 'timeout')
  if (Test-Path -LiteralPath 'attempted') {
    if (Healthy $previous) { Phase 'recovered'; exit 0 }
    # Never replay an installer; give its original process/old app time to acknowledge.
    Phase 'restored-awaiting-health'
    $end = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $timeout
    while ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -lt $end) {
      if (Healthy $previous) { Phase 'recovered'; exit 0 }
      Start-Sleep -Milliseconds 200
    }
    Phase 'failed'; exit 1
  }
  $resumingClaim = (Read 'decision') -ceq ('restore:' + $nonce)
  if (-not $resumingClaim) {
  $boot = [string](Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToFileTimeUtc()
  if (-not (Test-Path -LiteralPath 'armed-boot')) { [IO.File]::WriteAllText((Join-Path $Transaction 'armed-boot'), $boot) }
  Phase 'ready'
  $parentDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 300
  while ($true) {
    if (Test-Path -LiteralPath 'cancel') { Phase 'cancelled'; exit 0 }
    if (Test-Path -LiteralPath 'commit') {
      $parentId = [int](Read 'commit')
      if ((Read 'armed-boot') -cne $boot -or -not (Get-Process -Id $parentId -ErrorAction SilentlyContinue)) { break }
    }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -ge $parentDeadline) { Phase 'cancelled'; exit 0 }
    Start-Sleep -Milliseconds 200
  }
  Phase 'watching'
  if (-not (Test-Path -LiteralPath 'deadline')) { [IO.File]::WriteAllText((Join-Path $Transaction 'deadline'), [string]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $timeout)) }
  $end = [long](Read 'deadline')
  while ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -lt $end) {
    if (Test-Path -LiteralPath 'cancel') { Phase 'cancelled'; exit 0 }
    if (Healthy $target) { Phase 'healthy'; exit 0 }
    Start-Sleep -Milliseconds 200
  }
  if (Healthy $target) { Phase 'healthy'; exit 0 }
  }
  # Publish fully written payload atomically; a crash cannot leave an empty reservation.
  if (-not $resumingClaim) {
  $candidate = Join-Path $Transaction ('decision-restore-' + $PID)
  [IO.File]::WriteAllText($candidate, ('restore:' + $nonce))
  try { New-Item -ItemType HardLink -Path (Join-Path $Transaction 'decision') -Target $candidate -ErrorAction Stop | Out-Null }
  catch {
    Start-Sleep -Seconds 1
    if (Healthy $target) { Phase 'healthy'; exit 0 }
    throw 'Target health decision was interrupted'
  } finally { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }
  }
  New-Item -ItemType Directory -Path 'attempted' -ErrorAction Stop | Out-Null
  Phase 'recovering'
  $artifact = Read 'artifact'; $hash = Read 'sha256'
  # PowerShell 7 -> Node -> Windows PowerShell can inherit incompatible module paths.
  # Use .NET directly so verification does not depend on Get-FileHash module discovery.
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($artifact)
    try { $actualHash = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose() }
  } finally { $sha256.Dispose() }
  if ($actualHash -cne $hash) { throw 'Recovery artifact checksum mismatch' }
  # NSIS owns UAC/installation permissions. Never elevate without the system prompt.
  $installer = Start-Process -FilePath $artifact -ArgumentList @('/S', '--force-run', ('/D=' + (Read 'install-dir'))) -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw ('Installer failed: ' + $installer.ExitCode) }
  Phase 'restored-awaiting-health'
  $end = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $timeout
  while ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -lt $end) {
    if (Healthy $previous) { Phase 'recovered'; exit 0 }
    Start-Sleep -Milliseconds 200
  }
  throw 'Restored application did not confirm healthy startup'
} catch { Phase 'failed'; $_ | Out-File -LiteralPath (Join-Path $Transaction 'error.log'); exit 1 }
finally { $lock.Dispose() }
