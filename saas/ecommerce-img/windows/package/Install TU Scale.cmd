@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-TUScale.ps1"
if errorlevel 1 (
  echo.
  echo TU Scale installation failed. Please keep this window open and send the error message for troubleshooting.
  pause
  exit /b 1
)
echo.
pause
