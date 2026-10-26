$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSCommandPath
$node = [System.IO.Path]::GetFullPath((Join-Path $root 'runtime\node\node.exe'))
$stateDirectory = Join-Path $env:LOCALAPPDATA 'TU Scale\runtime-state'

foreach ($name in @('web', 'denoise')) {
  $pidFile = Join-Path $stateDirectory "$name.pid"
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { continue }
  $savedPid = 0
  [void][int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$savedPid)
  if ($savedPid -gt 0) {
    $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($process) {
      $processPath = $null
      try { $processPath = [System.IO.Path]::GetFullPath($process.Path) } catch {}
      if ($processPath -and $processPath -eq $node) {
        Stop-Process -Id $savedPid -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
