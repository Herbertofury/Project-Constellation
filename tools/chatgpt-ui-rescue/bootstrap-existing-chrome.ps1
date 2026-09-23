param(
  [string]$Repo = "Herbertofury/Project-Constellation"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here

function Find-Chrome {
  $PF86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $Candidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    $(if ($PF86) { Join-Path $PF86 "Google\Chrome\Application\chrome.exe" } else { $null }),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
  )
  foreach ($Path in $Candidates) {
    if ($Path -and (Test-Path $Path)) { return $Path }
  }
  throw "Google Chrome was not found."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) is required." }

gh auth status | Out-Host

$Chrome = Find-Chrome
$SourceRoot = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
if (!(Test-Path $SourceRoot)) { throw "Chrome user-data directory was not found." }

npm install --no-audit --no-fund
npx playwright install chromium

$Profiles = @()
if (Test-Path (Join-Path $SourceRoot "Default")) { $Profiles += "Default" }
$Profiles += Get-ChildItem -Path $SourceRoot -Directory -Filter "Profile *" -ErrorAction SilentlyContinue |
  Sort-Object Name |
  ForEach-Object { $_.Name }

if ($Profiles.Count -eq 0) { throw "No Chrome profiles were found." }

$Output = Join-Path $Here ".chatgpt-storage-state.json"
Remove-Item $Output -Force -ErrorAction SilentlyContinue

$Captured = $false
foreach ($Profile in $Profiles) {
  Write-Host "Testing Chrome profile: $Profile"
  $TempRoot = Join-Path $env:TEMP ("ChatGPT-Rescue-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null

  try {
    $LocalState = Join-Path $SourceRoot "Local State"
    if (Test-Path $LocalState) {
      Copy-Item $LocalState (Join-Path $TempRoot "Local State") -Force
    }

    $SrcProfile = Join-Path $SourceRoot $Profile
    $DstProfile = Join-Path $TempRoot $Profile
    New-Item -ItemType Directory -Path $DstProfile -Force | Out-Null

    $null = & robocopy $SrcProfile $DstProfile /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP `
      /XD "Cache" "Code Cache" "GPUCache" "GrShaderCache" "ShaderCache" "DawnCache" "Media Cache" "Crashpad"

    $env:CHROME_USER_DATA_DIR = $TempRoot
    $env:CHROME_PROFILE_DIRECTORY = $Profile
    $env:CHROME_EXECUTABLE_PATH = $Chrome
    $env:CHATGPT_STORAGE_STATE_OUT = $Output

    node .\capture-existing-chrome.mjs
    if ($LASTEXITCODE -eq 0 -and (Test-Path $Output)) {
      $Captured = $true
      break
    }

    Remove-Item $Output -Force -ErrorAction SilentlyContinue
  }
  finally {
    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not $Captured) {
  throw "No existing Chrome profile produced an authenticated ChatGPT Scheduled session."
}

$Bytes = [System.IO.File]::ReadAllBytes($Output)
$B64 = [Convert]::ToBase64String($Bytes)

$B64 | gh secret set CHATGPT_STORAGE_STATE_B64 --repo $Repo
Remove-Item $Output -Force

Write-Host "Stored authenticated ChatGPT browser state in encrypted GitHub Actions secret."
Write-Host "Starting task-card rescue now..."
gh workflow run chatgpt-ui-scheduler-rescue.yml --repo $Repo

Write-Host "Waiting for the rescue workflow to appear..."
Start-Sleep -Seconds 5
gh run list --repo $Repo --workflow chatgpt-ui-scheduler-rescue.yml --limit 3
