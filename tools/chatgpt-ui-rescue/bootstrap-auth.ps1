param(
  [string]$Repo = "Herbertofury/Project-Constellation"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required."
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required."
}

gh auth status
npm install
npx playwright install chromium

$State = Join-Path $Here ".chatgpt-storage-state.json"
$env:CHATGPT_STORAGE_STATE_OUT = $State
npm run auth:capture

if (!(Test-Path $State)) {
  throw "ChatGPT browser state was not created."
}

$Bytes = [System.IO.File]::ReadAllBytes($State)
$B64 = [Convert]::ToBase64String($Bytes)

$B64 | gh secret set CHATGPT_STORAGE_STATE_B64 --repo $Repo

Remove-Item $State -Force

Write-Host ""
Write-Host "Encrypted ChatGPT browser state stored in GitHub Actions."
Write-Host "Local browser-state file deleted."
Write-Host "Starting the rescue workflow now..."
gh workflow run chatgpt-ui-scheduler-rescue.yml --repo $Repo
