@echo off
echo ===================================================
echo [1/3] Downloading Electron v38.1.0 Windows binary...
echo ===================================================
curl -L -o "%~dp0electron.zip" https://github.com/electron/electron/releases/download/v38.1.0/electron-v38.1.0-win32-x64.zip

if not exist "%~dp0node_modules\electron\dist" mkdir "%~dp0node_modules\electron\dist"

echo ===================================================
echo [2/3] Extracting to node_modules\electron\dist...
echo ===================================================
tar -xf "%~dp0electron.zip" -C "%~dp0node_modules\electron\dist"

> "%~dp0node_modules\electron\path.txt" (set /p="electron.exe") <nul
if exist "%~dp0electron.zip" del "%~dp0electron.zip"

echo ===================================================
echo [3/3] ✅ Done! electron.exe is installed and ready.
echo ===================================================
