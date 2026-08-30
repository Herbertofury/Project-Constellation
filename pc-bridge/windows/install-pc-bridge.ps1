param(
  [string]$InstallDir = "$env:LOCALAPPDATA\PCX-029-PC-Bridge",
  [ValidateSet('stdio','http')][string]$Mode = 'stdio',
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$Source = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 22+ is required and was not found on PATH.'
}
$nodeVersion = (& node -p "process.versions.node")
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) { throw "Node.js 22+ is required. Found $nodeVersion" }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force "$Source\src" $InstallDir
Copy-Item -Force "$Source\package.json" $InstallDir
if (-not (Test-Path "$InstallDir\config.json")) {
  Copy-Item -Force "$Source\config.example.json" "$InstallDir\config.json"
}

[Environment]::SetEnvironmentVariable('PCX_BRIDGE_CONFIG', "$InstallDir\config.json", 'User')

if ($Mode -eq 'http') {
  $tokenBytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Fill($tokenBytes)
  $token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  [Environment]::SetEnvironmentVariable('PCX_BRIDGE_TOKEN', $token, 'User')
  [Environment]::SetEnvironmentVariable('PCX_BRIDGE_PORT', "$Port", 'User')
  $launcher = @"
`$env:PCX_BRIDGE_CONFIG = [Environment]::GetEnvironmentVariable('PCX_BRIDGE_CONFIG','User')
`$env:PCX_BRIDGE_TOKEN = [Environment]::GetEnvironmentVariable('PCX_BRIDGE_TOKEN','User')
`$env:PCX_BRIDGE_PORT = [Environment]::GetEnvironmentVariable('PCX_BRIDGE_PORT','User')
Set-Location '$InstallDir'
& node '.\src\server.mjs' --http
"@
  Set-Content -Encoding UTF8 -Path "$InstallDir\start-http.ps1" -Value $launcher
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\start-http.ps1`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'PCX-029 PC Bridge' -Action $action -Trigger $trigger -Settings $settings -Description 'Persistent authorized local MCP bridge for Project Constellation PCX-029.' -Force | Out-Null
  Start-ScheduledTask -TaskName 'PCX-029 PC Bridge'
  Write-Host "PC Bridge installed in HTTP mode at http://127.0.0.1:$Port/mcp"
  Write-Host 'Bearer token stored in the current user environment as PCX_BRIDGE_TOKEN.'
  Write-Host "View it with: [Environment]::GetEnvironmentVariable('PCX_BRIDGE_TOKEN','User')"
} else {
  Write-Host "PC Bridge installed for stdio use at $InstallDir"
  Write-Host "Command: node `"$InstallDir\src\server.mjs`" --stdio"
}

Write-Host "Config: $InstallDir\config.json"
Write-Host 'Edit allowed roots and command IDs there; arbitrary shell commands are intentionally disabled.'
