$ErrorActionPreference = 'Stop'

$sourceRoot = Split-Path -Parent $PSCommandPath
$programsRoot = Join-Path $env:LOCALAPPDATA 'Programs'
$installRoot = Join-Path $programsRoot 'TU Scale'
$stageRoot = Join-Path $programsRoot ("TU Scale.new.{0}" -f $PID)
$backupRoot = Join-Path $programsRoot ("TU Scale.old.{0}" -f $PID)

New-Item -ItemType Directory -Force -Path $programsRoot | Out-Null
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot | Out-Null

$items = @(
  'app',
  'runtime',
  'licenses',
  'Start TU Scale.cmd',
  'Stop TU Scale.cmd',
  'Uninstall TU Scale.cmd',
  'Start-TUScale.ps1',
  'Stop-TUScale.ps1',
  'Uninstall-TUScale.ps1',
  'README-Windows.txt',
  'THIRD-PARTY-NOTICES.txt',
  'CHECKSUMS-SHA256.txt',
  'TU Scale.ico'
)

try {
  foreach ($item in $items) {
    $source = Join-Path $sourceRoot $item
    if (-not (Test-Path -LiteralPath $source)) { throw "Installation package is missing: $item" }
    Copy-Item -LiteralPath $source -Destination $stageRoot -Recurse -Force
  }

  foreach ($required in @(
    (Join-Path $stageRoot 'runtime\node\node.exe'),
    (Join-Path $stageRoot 'runtime\python\python.exe'),
    (Join-Path $stageRoot 'app\dist\index.html'),
    (Join-Path $stageRoot 'app\dist\models\waifu2x.onnx'),
    (Join-Path $stageRoot 'app\waifu2x\models-scunet\scunet_color_real_psnr.onnx'),
    (Join-Path $stageRoot 'app\waifu2x\models-drunet\drunet_color.onnx')
  )) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Staged installation is incomplete: $required" }
  }

  if (Test-Path -LiteralPath (Join-Path $installRoot 'Stop-TUScale.ps1')) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot 'Stop-TUScale.ps1')
  }
  if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force }
  if (Test-Path -LiteralPath $installRoot) { Move-Item -LiteralPath $installRoot -Destination $backupRoot }
  Move-Item -LiteralPath $stageRoot -Destination $installRoot

  $shell = New-Object -ComObject WScript.Shell
  $desktopPath = [Environment]::GetFolderPath('Desktop')
  $startMenuPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  foreach ($shortcutPath in @(
    (Join-Path $desktopPath 'TU Scale.lnk'),
    (Join-Path $startMenuPath 'TU Scale.lnk')
  )) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $installRoot 'Start TU Scale.cmd'
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.IconLocation = (Join-Path $installRoot 'TU Scale.ico') + ',0'
    $shortcut.Description = 'TU Scale local image toolkit'
    $shortcut.Save()
  }

  if (Test-Path -LiteralPath $backupRoot) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host ''
  Write-Host "TU Scale installed successfully: $installRoot" -ForegroundColor Green
  Write-Host 'A desktop shortcut has been created. The app will open now.'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot 'Start-TUScale.ps1')
} catch {
  if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path -LiteralPath $installRoot) -and (Test-Path -LiteralPath $backupRoot)) {
    Move-Item -LiteralPath $backupRoot -Destination $installRoot -ErrorAction SilentlyContinue
  }
  throw
}
