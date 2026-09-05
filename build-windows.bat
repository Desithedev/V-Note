@echo off
title Building V-Note Windows Executable
color 0A
echo ========================================================
echo        DONG GOI UNG DUNG V-NOTE (WINDOWS X64)
echo ========================================================
echo.

cd /d "%~dp0apps\desktop"

echo [1/3] Dong cac tien trinh cu dang chay ngam...
taskkill /F /IM "electron.exe" >nul 2>&1
taskkill /F /IM "Prismical.exe" >nul 2>&1
taskkill /F /IM "V-Note.exe" >nul 2>&1

echo [2/3] Tien hanh dong goi ung dung...
echo.
call pnpm run package:windows

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   THANH CONG! File chay da duoc xuat tai:
    echo   %~dp0apps\desktop\out\V-Note-win32-x64\V-Note.exe
    echo ========================================================
    echo.
    if exist "%~dp0apps\desktop\out\V-Note-win32-x64" (
        explorer "%~dp0apps\desktop\out\V-Note-win32-x64"
    ) else if exist "%~dp0apps\desktop\out\Prismical-win32-x64" (
        explorer "%~dp0apps\desktop\out\Prismical-win32-x64"
    )
) else (
    echo.
    echo [ERROR] Co loi xay ra trong qua trinh dong goi!
)

pause
