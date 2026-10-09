param([Parameter(Mandatory=$true)][string]$Transaction)
$ErrorActionPreference = 'Stop'
# Exit this short-lived parent before NSIS starts. Its taskkill /T must not see
# the guardian as a descendant of the application that is being replaced.
$arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', ('"' + (Join-Path $Transaction 'guardian.ps1') + '"'), '-Transaction', ('"' + $Transaction + '"'))
Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
