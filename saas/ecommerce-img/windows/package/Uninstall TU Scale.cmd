@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-TUScale.ps1"
if errorlevel 1 (
  echo.
  echo TU Scale uninstall failed.
  pause
  exit /b 1
)
echo.
pause
