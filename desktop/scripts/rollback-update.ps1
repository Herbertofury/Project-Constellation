param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$StateDir,
  [Parameter(Mandatory=$true)][string]$ExecutableName,
  [int]$WaitPid = 0
)
$ErrorActionPreference='Stop'
if($WaitPid -gt 0){ try { Wait-Process -Id $WaitPid -Timeout 90 -ErrorAction Stop } catch {} }
$updates=Join-Path $StateDir 'updates'
$backup=Get-ChildItem -LiteralPath $updates -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $backup){ throw 'No Project Constellation rollback backup is available.' }
$failed=Join-Path $updates ("failed-"+(Get-Date).ToString('yyyyMMdd-HHmmss'))
if(Test-Path -LiteralPath $InstallDir){Move-Item -LiteralPath $InstallDir -Destination $failed -Force}
Move-Item -LiteralPath $backup.FullName -Destination $InstallDir -Force
$exe=Join-Path $InstallDir $ExecutableName
if(-not (Test-Path -LiteralPath $exe)){throw 'Rollback restored files but executable is missing.'}
Start-Process -FilePath $exe | Out-Null
