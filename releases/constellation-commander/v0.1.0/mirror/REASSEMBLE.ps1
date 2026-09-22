$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$parts = Get-ChildItem -LiteralPath $here -Filter 'Constellation-Commander-v0.1.0.zip.b64.part*' | Sort-Object Name
if ($parts.Count -ne 5) { throw "Expected 5 Base64 parts, found $($parts.Count)." }
$b64 = ($parts | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join ''
$out = Join-Path $here 'Constellation-Commander-v0.1.0.zip'
[IO.File]::WriteAllBytes($out, [Convert]::FromBase64String($b64))
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
$expected = '6d7010d5b4025a9bf74e9b6c367028454440ae6f09d7b20240f8c85fb0a45612'
if ($actual -ne $expected) { Remove-Item -LiteralPath $out -Force; throw "SHA-256 mismatch: $actual" }
Write-Host "Reassembled and verified: $out" -ForegroundColor Green
Write-Host "SHA-256: $actual"
