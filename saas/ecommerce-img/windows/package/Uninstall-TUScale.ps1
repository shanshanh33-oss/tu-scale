$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath)).TrimEnd('\')
$expected = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\TU Scale')).TrimEnd('\')
if ($root -ne $expected) {
  throw "For safety, uninstall only runs from the installed directory: $expected"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'Stop-TUScale.ps1')

$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TU Scale.lnk'
$startMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\TU Scale.lnk'
Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $startMenuShortcut -Force -ErrorAction SilentlyContinue

$cleanupScript = Join-Path $env:TEMP ("tuscale-uninstall-{0}.cmd" -f $PID)
$lines = @(
  '@echo off',
  'timeout /t 2 /nobreak >nul',
  'rmdir /s /q "%LOCALAPPDATA%\Programs\TU Scale"',
  'del /q "%~f0"'
)
Set-Content -LiteralPath $cleanupScript -Value $lines -Encoding ASCII
Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /c "{0}"' -f $cleanupScript) -WindowStyle Hidden
Write-Host 'TU Scale has been uninstalled. Browser history remains in the browser profile unless you clear it there.'
