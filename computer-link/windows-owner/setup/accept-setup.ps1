$ErrorActionPreference = 'Stop'
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Official runner Inno compiler unavailable; no fallback download' }
$compilerVersion = (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion
Write-Output ('Installed ISCC file version: ' + $compilerVersion)
# ISCC's executable resource can be 0.0.0.0; gate the actual engine banner before executing setup.
$root = Join-Path $env:RUNNER_TEMP ('computer-link-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$binaries = @('computer-link-owner-proof.exe','local-client.exe','computer-link-mcp-session.exe')
if (-not $env:CARGO_TARGET_DIR -or -not [IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) { throw 'An explicit absolute shared CARGO_TARGET_DIR is required; no build-tree fallback' }
$debug = Join-Path $env:CARGO_TARGET_DIR 'debug'
$stage = Join-Path $root 'payload'
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($name in $binaries) {
  Copy-Item -LiteralPath (Join-Path $debug $name) -Destination $stage
}
$recipe = Join-Path $PSScriptRoot 'computer-link.iss'
# Consume output without retaining or publishing compiler paths/licensee text.
# PowerShell still materializes each native output line; this is not a hard memory bound.
$compilerCharacters = 0
$engineVerified = $false
& $compiler "/DPayloadDir=$stage" "/O$root" $recipe 2>&1 | ForEach-Object {
  $line = [string]$_
  $compilerCharacters += $line.Length + 1
  if ($compilerCharacters -gt 1048576) { throw 'Compiler output exceeds character review gate; setup will not execute' }
  if ($line -match '^Compiler engine version: .+ 6\.7\.1\s*$') { $engineVerified = $true }
}
$compileExit = $LASTEXITCODE
Write-Output ('Compiler exit status: ' + $compileExit)
if ($compileExit -ne 0) { throw 'Setup compilation failed; raw compiler output is not published' }
if (-not $engineVerified) { throw 'Compiler engine is not reviewed 6.7.1; setup will not execute' }
Write-Output 'Verified compiler engine version: 6.7.1'
$setup = Join-Path $root 'Computer-Link-Local-Preview-Setup.exe'
$destination = Join-Path $root 'installed-preview'
function Run-Owned([string]$exe, [string[]]$arguments) {
  $info = [Diagnostics.ProcessStartInfo]::new($exe)
  $info.UseShellExecute = $false
  foreach ($argument in $arguments) { $info.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::Start($info)
  if (-not $process.WaitForExit(120000)) { $process.Kill(); $null = $process.WaitForExit(5000); throw 'Owned setup process timed out; no completion claimed' }
  return $process.ExitCode
}
$arguments = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/DIR=$destination")
if ((Run-Owned $setup $arguments) -ne 0) { throw 'Disposable setup failed' }
foreach ($name in $binaries) {
  if ((Get-FileHash -LiteralPath (Join-Path $stage $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash) { throw 'Installed bytes differ from tested binaries' }
}
# Snapshot the disposable installed tree. GUI operations must not add logs, state,
# configuration, autostart entries or helper binaries inside this portable payload.
function Installed-Manifest {
  return @(Get-ChildItem -LiteralPath $destination -Recurse -File | Sort-Object FullName | ForEach-Object {
    $_.FullName.Substring($destination.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash
  })
}
$installedBefore = Installed-Manifest
# Re-run the real GUI workflows against installed bytes, with installed-folder CWD.
# Test-only routing fails closed if an installed executable is missing; never falls back.
$previousTestDirectory = $env:COMPUTER_LINK_TEST_INSTALLED_DIR
try {
  $env:COMPUTER_LINK_TEST_INSTALLED_DIR = $destination
  & cargo +1.99.1 test --locked --manifest-path windows-owner/Cargo.toml --test gui --test selection -- --test-threads=1 --nocapture
  if ($LASTEXITCODE -ne 0) { throw 'Installed native GUI/selection/export acceptance failed' }
  & cargo +1.99.1 test --locked --manifest-path windows-owner/Cargo.toml --test probe_gui -- --ignored --test-threads=1 --nocapture
  if ($LASTEXITCODE -ne 0) { throw 'Installed native snapshot/status MCP acceptance failed' }
  & cargo +1.99.1 test --locked --manifest-path mcp-session/Cargo.toml --test owner_interactive actual_partial_status_frame_disconnect_and_fresh_session -- --exact --test-threads=1 --nocapture
  if ($LASTEXITCODE -ne 0) { throw 'Installed partial status frame revocation acceptance failed' }
  & cargo +1.99.1 test --locked --manifest-path windows-owner/Cargo.toml --test focus_gui keyboard_tab_arrow_review_and_default_cancel -- --exact --test-threads=1 --nocapture
  if ($LASTEXITCODE -ne 0) { throw 'Installed keyboard foreground-selector acceptance failed' }
} finally {
  $env:COMPUTER_LINK_TEST_INSTALLED_DIR = $previousTestDirectory
}
$installedAfter = Installed-Manifest
if (@(Compare-Object $installedBefore $installedAfter).Count -ne 0) { throw 'Installed acceptance wrote or changed payload state' }
# No persistence assertions are made about all Windows state: this checks the
# installed folder, source-reviewed no service/autostart recipe, and owned processes.
Write-Output 'Installed executable GUI, pairing, selection, create-new export, MCP snapshot/status, cancellation and Exit acceptance passed.'
# Verify the workflows did not alter any installed program.
foreach ($name in $binaries) {
  if ((Get-FileHash -LiteralPath (Join-Path $stage $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash) { throw 'Installed GUI tests changed program bytes' }
}
$marker = Join-Path $destination 'unrelated-synthetic-user-data.txt'
[IO.File]::WriteAllText($marker,'preserve-this-fixture')
$refusalLog = Join-Path $root 'reinstall.log'
if ((Run-Owned $setup ($arguments + @('/LOG=' + $refusalLog))) -eq 0) { throw 'Existing-folder reinstall incorrectly accepted' }
if ((Get-Item -LiteralPath $refusalLog).Length -gt 1048576) { throw 'Refusal log exceeds test bound' }
if (-not ([IO.File]::ReadAllText($refusalLog).Contains('Choose a new destination folder. Existing folders are refused'))) { throw 'Reinstall failed without expected preservation refusal' }
if ([IO.File]::ReadAllText($marker) -ne 'preserve-this-fixture') { throw 'Reinstall changed unrelated fixture' }
foreach ($name in $binaries) {
  if ((Get-FileHash -LiteralPath (Join-Path $stage $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $name)).Hash) { throw 'Rejected reinstall changed installed program bytes' }
}
$uninstaller = Join-Path $destination 'unins000.exe'
if ((Run-Owned $uninstaller @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART')) -ne 0) { throw 'Disposable uninstall failed' }
if ([IO.File]::ReadAllText($marker) -ne 'preserve-this-fixture') { throw 'Uninstall changed unrelated fixture' }
foreach ($name in $binaries) {
  if (Test-Path -LiteralPath (Join-Path $destination $name)) { throw 'Program file still present after uninstall' }
}
Write-Output 'Disposable setup, exact installed bytes, existing-folder refusal and unrelated-data preservation passed. No artifact uploaded.'
