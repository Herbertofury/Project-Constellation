param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueAgent"),
  [string]$TaskName = "Project Constellation - ChatGPT Scheduled Rescue",
  [switch]$SkipStart,
  [string]$SourceDirectory
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

function Get-AgentPayloadSources([string]$Directory) {
  if ([string]::IsNullOrWhiteSpace($Directory)) {
    throw "SourceDirectory must name a local directory containing rescue.mjs, local-agent.mjs and package.json."
  }
  $Source = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
  if ($Source.PSProvider.Name -ne "FileSystem" -or -not $Source.PSIsContainer) {
    throw "SourceDirectory must name a filesystem directory: $Directory"
  }
  $Payload = @()
  foreach ($Name in @("rescue.mjs", "local-agent.mjs", "package.json")) {
    $File = Get-Item -LiteralPath (Join-Path $Source.FullName $Name) -Force -ErrorAction Stop
    if ($File.PSIsContainer -or ($File.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "SourceDirectory payload must be a regular file: $($File.FullName)"
    }
    $Payload += $File
  }
  return $Payload
}

function Copy-LocalAgentPayload([string]$SourceDirectory, [string]$InstallDirectory) {
  # Validate the complete set before copying any file, including on a repeat
  # install. Literal filesystem paths preserve metacharacters in checkout paths.
  $Payload = @(Get-AgentPayloadSources -Directory $SourceDirectory)
  foreach ($File in $Payload) {
    Write-Host "Copying $($File.Name) from the selected source directory..."
    [IO.File]::Copy($File.FullName, (Join-Path $InstallDirectory $File.Name), $true)
  }
}

function New-AgentRunnerScript([string]$Directory, [string]$NodePath) {
  # These variables belong to the future runner. A single-quoted template keeps
  # the installer from expanding them or freezing its own npm exit status.
  # PowerShell literal strings also preserve apostrophes, $, backticks and [].
  $LiteralDirectory = $Directory.Replace("'", "''")
  $LiteralNode = $NodePath.Replace("'", "''")
  $LiteralAgent = (Join-Path $Directory "local-agent.mjs").Replace("'", "''")
  return (@'
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '{0}'
& '{1}' '{2}'
exit $LASTEXITCODE
'@ -f $LiteralDirectory, $LiteralNode, $LiteralAgent)
}

# Invalid local sources must fail before installing tools, creating a profile,
# or replacing an existing task. With no option, retain the current main download.
$UseLocalPayload = $PSBoundParameters.ContainsKey("SourceDirectory")
if ($UseLocalPayload) {
  Get-AgentPayloadSources -Directory $SourceDirectory | Out-Null
}

$Node = Ensure-Tool "node.exe" "OpenJS.NodeJS.LTS"
$Npm = Ensure-Tool "npm.cmd" "OpenJS.NodeJS.LTS"
$Chrome = Find-Chrome

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$ProfileDir = Join-Path $env:LOCALAPPDATA "ProjectConstellation\ChatGPTRescueChrome"
New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null

if ($UseLocalPayload) {
  Copy-LocalAgentPayload -SourceDirectory $SourceDirectory -InstallDirectory $InstallDir
} else {
  $Base = "https://raw.githubusercontent.com/Herbertofury/Project-Constellation/main/tools/chatgpt-ui-rescue"
  $Files = @("rescue.mjs", "local-agent.mjs", "package.json")
  foreach ($File in $Files) {
    $Target = Join-Path $InstallDir $File
    Write-Host "Downloading $File..."
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$File" -OutFile $Target
  }
}

Push-Location -LiteralPath $InstallDir
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
$Config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $InstallDir "agent-config.json") -Encoding UTF8

$Runner = Join-Path $InstallDir "run-agent.ps1"
$RunnerBody = New-AgentRunnerScript -Directory $InstallDir -NodePath $Node
$RunnerBody | Set-Content -LiteralPath $Runner -Encoding UTF8

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

if (-not $SkipStart) {
  Write-Host "Starting local rescue agent now..."
  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$Runner`""
  ) -WindowStyle Hidden
  Start-Sleep -Seconds 3
} else {
  Write-Host "SkipStart requested; agent was installed and registered but not launched."
}
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
