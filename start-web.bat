@echo off
cd /d "%~dp0"
echo ===================================================
echo [V-Note] Starting Web Application...
echo ===================================================
pnpm --filter @v-note/www dev
pause
