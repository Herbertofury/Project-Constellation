param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueAgent"),
  [string]$TaskName = "Project Constellation - ChatGPT Scheduled Rescue",
  [switch]$RemoveChromeProfile
)

$ErrorActionPreference = "SilentlyContinue"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*ChatGPTRescueAgent*local-agent.mjs*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }

if ($RemoveChromeProfile) {
  $ProfileDir = Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueChrome"
  if (Test-Path $ProfileDir) { Remove-Item $ProfileDir -Recurse -Force }
}

Write-Host "Removed $TaskName."
if (-not $RemoveChromeProfile) {
  Write-Host "The dedicated Chrome profile was preserved. Use -RemoveChromeProfile to delete it too."
}
