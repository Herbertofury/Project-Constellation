$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
  npm install --no-audit --no-fund
  npm run check
  npm test
  npm run build:win
  Write-Host "Built integrated Electron artifacts under $(Join-Path $Root 'dist-electron')"
}
finally { Pop-Location }
