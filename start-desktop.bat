@echo off
cd /d "%~dp0"
echo ===================================================
echo [V-Note] Starting Desktop Application...
echo ===================================================
pnpm --filter @prismical/desktop dev
pause
