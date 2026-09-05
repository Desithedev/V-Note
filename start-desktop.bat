@echo off
cd /d "%~dp0"
echo [1/2] Dong cac tien trinh cu dang chay ngam...
taskkill /F /IM "electron.exe" >nul 2>&1
taskkill /F /IM "Prismical.exe" >nul 2>&1
taskkill /F /IM "V-Note.exe" >nul 2>&1

echo [2/2] Khoi dong V-Note Desktop (Dev Mode)...
pnpm --filter @v-note/desktop dev
pause
