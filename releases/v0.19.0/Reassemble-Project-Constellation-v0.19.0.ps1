$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Root 'Project-Constellation-v0.19.0-Windows-Portable.zip'
$Parts = Get-ChildItem -LiteralPath $Root -Filter 'Project-Constellation-v0.19.0-Windows-Portable.zip.part-*' | Sort-Object Name
if (-not $Parts -or $Parts.Count -lt 2) { throw 'Portable parts are missing.' }
$stream = [System.IO.File]::Open($Out, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  foreach ($p in $Parts) {
    $input = [System.IO.File]::OpenRead($p.FullName)
    try { $input.CopyTo($stream) } finally { $input.Dispose() }
  }
} finally { $stream.Dispose() }
$Expected = 'f9cb6a4d2bf0a5322d1a206eb388df36c2c156d2744d28ea7864998c445bdf3c'
$Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Out).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) { throw "SHA-256 mismatch. Expected $Expected, got $Actual" }
Write-Host "Verified: $Out"
Write-Host "SHA-256: $Actual"
