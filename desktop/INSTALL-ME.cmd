@echo off
setlocal
cd /d "%~dp0"
echo Constellation Commander v0.7 is an integrated Electron app.
echo.
echo This source bundle is for development. For normal installation, run the packaged
echo Constellation Commander Setup EXE from the release bundle.
echo.
if exist "dist-electron\*.exe" (
  for %%F in ("dist-electron\*.exe") do (
    echo Launching %%~nxF
    start "" "%%~fF"
    exit /b 0
  )
)
echo No packaged installer was found in this source tree.
echo Build one with: npm install ^&^& npm run build:win
pause
