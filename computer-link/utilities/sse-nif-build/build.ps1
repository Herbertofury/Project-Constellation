$ErrorActionPreference = 'Stop'
function GitChecked([string[]]$ArgsList) {
 & git @ArgsList
 if ($LASTEXITCODE -ne 0) { throw "git failed: $($ArgsList -join ' ')" }
}
$base=$PWD.Path
GitChecked @('clone','https://github.com/ousnius/SSE-NIF-Optimizer.git','SSE-NIF-Optimizer')
GitChecked @('-C','SSE-NIF-Optimizer','checkout','--detach','d043013c0af767556041b7495f8f9744a625b7db')
GitChecked @('-C','SSE-NIF-Optimizer','submodule','update','--init','--recursive')
$nif=(& git -C SSE-NIF-Optimizer/external/nifly rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $nif -ne '846518b3fdfc6c81cddc49188aff77ad7006456a') { throw 'nifly mismatch' }
GitChecked @('clone','https://github.com/wxWidgets/wxWidgets.git','wxWidgets')
GitChecked @('-C','wxWidgets','checkout','--detach','db1005db3dea2c37a46fb455a9a02e37aa360751')
GitChecked @('-C','wxWidgets','submodule','update','--init','--recursive')
$vswhere=Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (!$vs) { throw 'MSVC absent' }
$dev=Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
New-Item -ItemType Directory -Path deliverable | Out-Null
@"
@echo off
call "$dev" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
cd /d "$base\wxWidgets\build\msw"
nmake /f makefile.vc BUILD=release SHARED=0 RUNTIME_LIBS=static TARGET_CPU=X64
if errorlevel 1 exit /b 1
cd /d "$base\SSE-NIF-Optimizer"
msbuild "SSE NIF Optimizer.sln" /m /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v145
if errorlevel 1 exit /b 1
dumpbin /dependents "build\x64\Release\SSE NIF Optimizer.exe" > "$base\deliverable\PE-DEPENDENCIES.txt"
if errorlevel 1 exit /b 1
"@ | Set-Content -Encoding ascii build.cmd
& cmd /c build.cmd
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
$exe=Join-Path $base 'SSE-NIF-Optimizer\build\x64\Release\SSE NIF Optimizer.exe'
if (!(Test-Path $exe)) { throw 'Executable missing' }
$smoke=Join-Path $env:RUNNER_TEMP ('nif-smoke-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $smoke | Out-Null
$p=Start-Process -FilePath $exe -WorkingDirectory $smoke -PassThru
try {
 if (!$p.WaitForInputIdle(20000)) { throw 'GUI not input-idle' }
 $p.Refresh()
 if ($p.HasExited -or $p.MainWindowHandle -eq 0) { throw 'GUI absent' }
 $title=$p.MainWindowTitle
 if (!$p.CloseMainWindow()) { throw 'Close not accepted' }
 if (!$p.WaitForExit(10000) -or $p.ExitCode -ne 0) { throw 'GUI exit failed' }
} finally { if (!$p.HasExited) { $p.Kill(); $p.WaitForExit() } }
$empty=Join-Path $smoke 'empty'
New-Item -ItemType Directory -Path $empty | Out-Null
$log=Join-Path $smoke 'smoke.log'
$start=[Diagnostics.ProcessStartInfo]::new()
$start.FileName=$exe
$start.WorkingDirectory=$smoke
$start.UseShellExecute=$false
foreach($arg in @('--optimize','SSE','--log',$log,$empty)) { $start.ArgumentList.Add($arg) }
$p=[Diagnostics.Process]::new()
$p.StartInfo=$start
if (!$p.Start()) { throw 'CLI launch failed' }
try {
 if (!$p.WaitForExit(20000)) { throw 'Empty-input CLI timeout' }
 Write-Output "Empty-input CLI exit code: $($p.ExitCode)"
 if (Test-Path $log) { Get-Content $log }
 if ($p.ExitCode -ne 0) { throw 'Empty-input CLI nonzero exit' }
}
finally { if (!$p.HasExited) { $p.Kill(); $p.WaitForExit() } }
if (!(Test-Path $log) -or !(Select-String -Path $log -SimpleMatch 'SSE NIF Optimizer v3.2.2' -Quiet)) { throw 'Version log missing' }
Copy-Item $exe 'deliverable/SSE NIF Optimizer.exe'
Copy-Item SSE-NIF-Optimizer/LICENSE deliverable/LICENSE-GPLv3.txt
Copy-Item wxWidgets/docs/licence.txt deliverable/LICENSE-wxWindows.txt
Copy-Item build.ps1,build.cmd deliverable/
Copy-Item $log deliverable/EMPTY-INPUT-SMOKE.log
& tar -czf deliverable/corresponding-source.tar.gz --exclude=.git --exclude=build/temp --exclude=build/x64 --exclude=lib/vc_x64_lib --exclude=vc_x64_mswu SSE-NIF-Optimizer wxWidgets
if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed' }
@{
 optimizer='d043013c0af767556041b7495f8f9744a625b7db'; nifly=$nif
 wxWidgets='db1005db3dea2c37a46fb455a9a02e37aa360751'
 runner=$env:ImageVersion; OS=[Environment]::OSVersion.VersionString
 compilerToolset='v145'; architecture='x64'; runtime='static /MT'; wxLink='static'
 guiInputIdle=$true; guiWindowTitle=$title; guiCloseExitCode=0; emptyInputExitCode=0
 limitations=@('No real mesh conversion or game correctness test','No Windows 10/11 end-user desktop qualification','Unofficial unsigned source build')
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 deliverable/BUILD-VERIFICATION.json
@'
SSE NIF Optimizer 3.2.2, unofficial Windows x64 source build.
Extract the whole folder and run SSE NIF Optimizer.exe normally.
Back up meshes first and operate on copies: this utility can rewrite selected files.
No user game/mod data was used. Tests cover GUI creation/input-idle/close and empty-folder CLI only, not mesh correctness, game compatibility or full folder-local OS data behavior.
GPLv3 license, dependency license and corresponding source are included with build recipe. Preserve license/source when redistributing. No upstream endorsement or signature is claimed.
'@ | Set-Content -Encoding utf8 deliverable/README.txt
Get-ChildItem deliverable -File | ForEach-Object { $h=Get-FileHash -Algorithm SHA256 $_.FullName; "$($h.Hash.ToLower())  $($_.Name)" } | Set-Content -Encoding ascii deliverable/SHA256SUMS.txt
