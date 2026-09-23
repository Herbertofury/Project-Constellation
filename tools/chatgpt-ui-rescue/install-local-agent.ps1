param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueAgent"),
  [string]$TaskName = "Project Constellation - ChatGPT Scheduled Rescue"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Ensure-Tool([string]$Command, [string]$WingetId) {
  $found = Get-Command $Command -ErrorAction SilentlyContinue
  if ($found) { return $found.Source }
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "$Command is required and winget is unavailable to install $WingetId."
  }
  Write-Host "Installing $WingetId..."
  winget install --id $WingetId --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  Refresh-Path
  $found = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $found) { throw "$Command was not found after installing $WingetId." }
  return $found.Source
}

function Find-Chrome {
  $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    $(if ($pf86) { Join-Path $pf86 "Google\Chrome\Application\chrome.exe" } else { $null }),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    Write-Host "Installing Google Chrome..."
    winget install --id Google.Chrome --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    foreach ($candidate in $candidates) {
      if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
  }
  throw "Google Chrome could not be found."
}

$Node = Ensure-Tool "node.exe" "OpenJS.NodeJS.LTS"
$Npm = Ensure-Tool "npm.cmd" "OpenJS.NodeJS.LTS"
$Chrome = Find-Chrome

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$ProfileDir = Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueChrome"
New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null

$Base = "https://raw.githubusercontent.com/Herbertofury/Project-Constellation/main/tools/chatgpt-ui-rescue"
$Files = @("rescue.mjs", "local-agent.mjs", "package.json")
foreach ($File in $Files) {
  $Target = Join-Path $InstallDir $File
  Write-Host "Downloading $File..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File" -OutFile $Target
}

Push-Location $InstallDir
try {
  & $Npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$Config = [ordered]@{
  heartbeatUrl = "https://api.github.com/repos/Herbertofury/Project-Constellation/issues/40"
  cdpUrl = "http://127.0.0.1:9222"
  chromePath = $Chrome
  profileDir = $ProfileDir
  heartbeatPollSeconds = 240
  minRescueIntervalSeconds = 55
  cdpReadySeconds = 25
  rescueTimeoutSeconds = 120
}
$Config | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $InstallDir "agent-config.json") -Encoding UTF8

$Runner = Join-Path $InstallDir "run-agent.ps1"
$RunnerBody = @"
$ErrorActionPreference = "Continue"
Set-Location "$InstallDir"
& "$Node" "$InstallDir\local-agent.mjs"
exit $LASTEXITCODE
"@
$RunnerBody | Set-Content -Path $Runner -Encoding UTF8

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`"" `
  -WorkingDirectory $InstallDir

$FirstRun = (Get-Date).AddMinutes(1)
$MinuteTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At $FirstRun `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

$Principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger @($MinuteTrigger, $LogonTrigger) `
  -Settings $Settings `
  -Principal $Principal `
  -Description "Repairs blocked ChatGPT Scheduled tasks using the local persistent Chrome session; externally heartbeated by GitHub." `
  -Force | Out-Null

Write-Host "Starting local rescue agent now..."
Start-Process powershell.exe -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$Runner`""
) -WindowStyle Hidden

Start-Sleep -Seconds 3
$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ""
Write-Host "Installed: $TaskName"
Write-Host "Task state: $($Task.State)"
Write-Host "Next run: $($Info.NextRunTime)"
Write-Host "Agent folder: $InstallDir"
Write-Host "Chrome rescue profile: $ProfileDir"
Write-Host ""
Write-Host "A local Chrome window will open to ChatGPT Scheduled if the dedicated rescue profile needs login or verification."
Write-Host "Sign in there once. After that, the agent retries automatically every minute."
