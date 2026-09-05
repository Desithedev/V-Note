@echo off
cd /d "%~dp0"
echo ===================================================
echo [V-Note] Starting Web Application...
echo ===================================================
pnpm --filter @prismical/www dev
pause
