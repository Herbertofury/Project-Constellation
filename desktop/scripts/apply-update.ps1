param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$StateDir,
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$ExecutableName,
  [int]$WaitPid = 0
)
$ErrorActionPreference='Stop'
if($WaitPid -gt 0){ try { Wait-Process -Id $WaitPid -Timeout 90 -ErrorAction Stop } catch {} }
if(-not (Test-Path -LiteralPath $Archive)){ throw "Update archive missing: $Archive" }
$updates=Join-Path $StateDir 'updates'; New-Item -ItemType Directory -Force -Path $updates | Out-Null
$stage=Join-Path $updates ("stage-"+$Version); if(Test-Path $stage){Remove-Item $stage -Recurse -Force}; Expand-Archive -LiteralPath $Archive -DestinationPath $stage -Force
$exe=Get-ChildItem -LiteralPath $stage -Filter $ExecutableName -File -Recurse | Select-Object -First 1
if(-not $exe){ throw "Verified archive did not contain $ExecutableName" }
$payload=$exe.Directory.FullName
$stamp=(Get-Date).ToString('yyyyMMdd-HHmmss'); $backup=Join-Path $updates ("backup-"+$stamp)
if(Test-Path -LiteralPath $InstallDir){ Move-Item -LiteralPath $InstallDir -Destination $backup -Force }
try {
  Move-Item -LiteralPath $payload -Destination $InstallDir -Force
  $newExe=Join-Path $InstallDir $ExecutableName
  if(-not (Test-Path -LiteralPath $newExe)){ throw "Updated executable is missing after install." }
  Start-Process -FilePath $newExe | Out-Null
} catch {
  if(Test-Path -LiteralPath $InstallDir){Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $backup){Move-Item -LiteralPath $backup -Destination $InstallDir -Force}
  throw
} finally { if(Test-Path $stage){Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue} }
