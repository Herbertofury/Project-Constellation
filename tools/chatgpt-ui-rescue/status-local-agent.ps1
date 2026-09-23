param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueAgent"),
  [string]$TaskName = "Project Constellation - ChatGPT Scheduled Rescue"
)

$ErrorActionPreference = "SilentlyContinue"
$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
$StateFile = Join-Path $InstallDir "agent-state.json"
$LogFile = Join-Path $InstallDir "agent.log.jsonl"

Write-Host "Task: $TaskName"
if ($Task) {
  Write-Host "State: $($Task.State)"
  Write-Host "Last run: $($Info.LastRunTime)"
  Write-Host "Last result: $($Info.LastTaskResult)"
  Write-Host "Next run: $($Info.NextRunTime)"
} else {
  Write-Host "State: NOT INSTALLED"
}

if (Test-Path $StateFile) {
  Write-Host ""
  Write-Host "Agent state:"
  Get-Content $StateFile
}

if (Test-Path $LogFile) {
  Write-Host ""
  Write-Host "Recent agent log:"
  Get-Content $LogFile -Tail 20
}
