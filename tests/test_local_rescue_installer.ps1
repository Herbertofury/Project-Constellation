param(
  [string]$InstallerPath = (Join-Path $PSScriptRoot "../tools/chatgpt-ui-rescue/install-local-agent.ps1")
)

$ErrorActionPreference = "Stop"
$Node = (Get-Command node -ErrorAction Stop).Source
$Shell = (Get-Process -Id $PID).Path
$Tokens = $null
$ParseErrors = $null
$Ast = [System.Management.Automation.Language.Parser]::ParseFile($InstallerPath, [ref]$Tokens, [ref]$ParseErrors)
if ($ParseErrors.Count -ne 0) { throw "Installer parse failed: $ParseErrors" }
foreach ($FunctionName in @("New-AgentRunnerScript", "Get-AgentPayloadSources", "Copy-LocalAgentPayload")) {
  $Function = $Ast.Find({
    param($Entry)
    $Entry -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Entry.Name -eq $FunctionName
  }, $true)
  if (-not $Function) { throw "Installer does not provide its isolated helper: $FunctionName" }
  # Evaluate only the selected filesystem/generator helpers, never the
  # installer's network, Chrome, profile, package or task registration commands.
  Invoke-Expression $Function.Extent.Text
}

$Fixture = Join-Path ([IO.Path]::GetTempPath()) ("constellation-runner-" + [Guid]::NewGuid().ToString("N"))
$AgentDir = Join-Path $Fixture 'agent '' quoted $literal `tick [bracket]'
try {
  [IO.Directory]::CreateDirectory($AgentDir) | Out-Null
  $SourceDir = Join-Path $Fixture 'checkout '' quoted $literal `tick [bracket]'
  [IO.Directory]::CreateDirectory($SourceDir) | Out-Null
  $PayloadNames = @("rescue.mjs", "local-agent.mjs", "package.json")
  foreach ($Name in $PayloadNames) {
    [IO.File]::WriteAllBytes((Join-Path $SourceDir $Name), [Text.Encoding]::UTF8.GetBytes("candidate bytes for $Name`n"))
  }
  Copy-LocalAgentPayload -SourceDirectory $SourceDir -InstallDirectory $AgentDir
  $ExpectedHashes = @{}
  foreach ($Name in $PayloadNames) {
    $ExpectedHashes[$Name] = (Get-FileHash -LiteralPath (Join-Path $SourceDir $Name) -Algorithm SHA256).Hash
    $ActualHash = (Get-FileHash -LiteralPath (Join-Path $AgentDir $Name) -Algorithm SHA256).Hash
    if ($ActualHash -ne $ExpectedHashes[$Name]) { throw "Local payload changed its source bytes: $Name" }
  }
  # A missing final payload must not partially overwrite an existing install.
  [IO.File]::WriteAllText((Join-Path $SourceDir "rescue.mjs"), "different candidate bytes")
  [IO.File]::Delete((Join-Path $SourceDir "package.json"))
  if ([IO.File]::Exists((Join-Path $SourceDir "package.json"))) {
    throw "The incomplete-source fixture still has package.json."
  }
  foreach ($InvalidSource in @("", (Join-Path $Fixture "missing-source"), $SourceDir)) {
    # Exercise the same preflight called before the installer creates profiles
    # or installs tools. It must reject a missing Get-Item result on PS 5.1.
    $Rejected = $false
    try { Get-AgentPayloadSources -Directory $InvalidSource | Out-Null }
    catch { $Rejected = $true }
    if (-not $Rejected) { throw "An incomplete local source passed preflight: $InvalidSource" }
    $Rejected = $false
    try { Copy-LocalAgentPayload -SourceDirectory $InvalidSource -InstallDirectory $AgentDir }
    catch { $Rejected = $true }
    if (-not $Rejected) { throw "An incomplete local source was accepted: $InvalidSource" }
    foreach ($Name in $PayloadNames) {
      $ActualHash = (Get-FileHash -LiteralPath (Join-Path $AgentDir $Name) -Algorithm SHA256).Hash
      if ($ActualHash -ne $ExpectedHashes[$Name]) { throw "Invalid source partially overwrote the installed payload: $Name" }
    }
  }
  [IO.Directory]::CreateDirectory((Join-Path $SourceDir "package.json")) | Out-Null
  $Rejected = $false
  try { Copy-LocalAgentPayload -SourceDirectory $SourceDir -InstallDirectory $AgentDir }
  catch { $Rejected = $true }
  if (-not $Rejected) { throw "A payload directory was accepted as package.json." }
  foreach ($Name in $PayloadNames) {
    $ActualHash = (Get-FileHash -LiteralPath (Join-Path $AgentDir $Name) -Algorithm SHA256).Hash
    if ($ActualHash -ne $ExpectedHashes[$Name]) { throw "A non-file payload partially overwrote the installed payload: $Name" }
  }
  Write-Host "PASS: local source copies all three exact payloads, preserves literal paths and rejects four invalid source cases without partial writes."

  $Agent = Join-Path $AgentDir "local-agent.mjs"
  [IO.File]::WriteAllText($Agent, @'
import fs from 'node:fs';
import assert from 'node:assert/strict';
// Windows TEMP can use an 8.3 alias. Verify filesystem identity, not spelling.
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(process.env.CONSTELLATION_RUNNER_TEST_DIR));
assert.equal(fs.realpathSync(process.argv[1]), fs.realpathSync(process.env.CONSTELLATION_RUNNER_TEST_SCRIPT));
fs.writeFileSync('runner-result.json', JSON.stringify({ pathsVerified: true }));
process.exit(Number(process.env.CONSTELLATION_RUNNER_TEST_EXIT));
'@, (New-Object Text.UTF8Encoding($false)))
  $LASTEXITCODE = 0
  $RunnerText = New-AgentRunnerScript -Directory $AgentDir -NodePath $Node
  $Runner = Join-Path $AgentDir "run-agent.ps1"
  [IO.File]::WriteAllText($Runner, $RunnerText, (New-Object Text.UTF8Encoding($true)))
  $RunnerErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Runner, [ref]$Tokens, [ref]$RunnerErrors) | Out-Null
  if ($RunnerErrors.Count -ne 0) { throw "Generated runner parse failed: $RunnerErrors" }
  $env:CONSTELLATION_RUNNER_TEST_DIR = $AgentDir
  $env:CONSTELLATION_RUNNER_TEST_SCRIPT = $Agent
  foreach ($ExpectedExit in @(7, 0)) {
    $env:CONSTELLATION_RUNNER_TEST_EXIT = "$ExpectedExit"
    & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Runner
    if ($LASTEXITCODE -ne $ExpectedExit) { throw "Runner returned $LASTEXITCODE, expected actual agent exit $ExpectedExit." }
    $Result = Get-Content -LiteralPath (Join-Path $AgentDir "runner-result.json") -Raw | ConvertFrom-Json
    if ($Result.pathsVerified -ne $true) {
      throw "Generated launcher reinterpreted the literal install path: $($Result | ConvertTo-Json -Compress)"
    }
  }
  Write-Host "PASS: isolated generated runner preserves paths and returns actual Node exits 7 and 0 ($($PSVersionTable.PSVersion))."
} finally {
  Remove-Item Env:CONSTELLATION_RUNNER_TEST_EXIT -ErrorAction SilentlyContinue
  Remove-Item Env:CONSTELLATION_RUNNER_TEST_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:CONSTELLATION_RUNNER_TEST_SCRIPT -ErrorAction SilentlyContinue
  if ([IO.Directory]::Exists($Fixture)) { [IO.Directory]::Delete($Fixture, $true) }
}
