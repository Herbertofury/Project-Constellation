$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Output = Join-Path $env:TEMP 'constellation-electron-smoke.json'
$Stdout = Join-Path $env:TEMP 'constellation-electron-smoke.stdout.log'
$Stderr = Join-Path $env:TEMP 'constellation-electron-smoke.stderr.log'
$Trace = "$Output.trace.log"
Remove-Item $Output,$Stdout,$Stderr,$Trace -Force -ErrorAction SilentlyContinue
$env:CONSTELLATION_ELECTRON_SMOKE = '1'
$env:CONSTELLATION_ELECTRON_SMOKE_OUTPUT = $Output
$env:ELECTRON_ENABLE_LOGGING = '1'
$Electron = Join-Path $Root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $Electron)) { throw "Electron runtime not found at $Electron" }
$proc = Start-Process -FilePath $Electron -ArgumentList '.' -WorkingDirectory $Root -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru
$deadline = (Get-Date).AddSeconds(45)
while (-not (Test-Path $Output) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
if (-not (Test-Path $Output)) {
  try { Stop-Process -Id $proc.Id -Force } catch {}
  $out = if (Test-Path $Stdout) { Get-Content $Stdout -Raw } else { '' }
  $err = if (Test-Path $Stderr) { Get-Content $Stderr -Raw } else { '' }
  $trace = if (Test-Path $Trace) { Get-Content $Trace -Raw } else { '' }
  throw "Electron integrated-chat smoke timed out.`nTRACE:`n$trace`nSTDOUT:`n$out`nSTDERR:`n$err"
}
$data = Get-Content $Output -Raw | ConvertFrom-Json
if ($data.ok -ne $true -or $data.event -ne 'tool-result-sent' -or $data.detail.ok -ne $true -or $data.detail.pong -ne $true -or $data.detail.visibleLeak -ne $false -or $data.detail.shellRuntime.ok -ne $true -or $data.detail.shellRuntime.version -ne '0.23.0' -or $data.detail.shellRuntime.toolCount -lt 45 -or $data.detail.shellRuntime.singleInstanceOwner -ne $true -or $data.detail.shellRuntime.health.ok -ne $true) {
  $out = if (Test-Path $Stdout) { Get-Content $Stdout -Raw } else { '' }
  $err = if (Test-Path $Stderr) { Get-Content $Stderr -Raw } else { '' }
  $trace = if (Test-Path $Trace) { Get-Content $Trace -Raw } else { '' }
  throw "Electron integrated-chat smoke failed: $(Get-Content $Output -Raw)`nTRACE:`n$trace`nSTDOUT:`n$out`nSTDERR:`n$err"
}
if (-not $proc.WaitForExit(10000)) {
  try { Stop-Process -Id $proc.Id -Force } catch {}
  throw 'Integrated Electron smoke produced a result but did not confirm graceful application shutdown.'
}
if ($proc.ExitCode -ne 0) { throw "Integrated Electron smoke exited with code $($proc.ExitCode)." }
Write-Host 'Project Constellation integrated Electron ChatGPT smoke: PASS'
