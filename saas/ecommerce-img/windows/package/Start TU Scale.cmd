@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-TUScale.ps1"
if errorlevel 1 (
  echo.
  echo TU Scale failed to start. Logs are in %%LOCALAPPDATA%%\TU Scale\logs.
  pause
  exit /b 1
)
