[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'TU Scale Dev'
$stateFile = Join-Path $stateDirectory 'runtime-state.json'

if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
  Write-Host 'No TU Scale development processes are recorded.'
  exit 0
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json

function Stop-RecordedProcess($name, $record) {
  if (-not $record -or -not $record.pid) { return }
  $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  if (-not $process) {
    Write-Host "$name is already stopped."
    return
  }

  $actualStartTime = $process.StartTime.ToUniversalTime().ToFileTimeUtc()
  if ([int64]$actualStartTime -ne [int64]$record.startTimeUtcFileTime) {
    Write-Warning "Skipped PID $($record.pid) because it now belongs to a different process."
    return
  }

  Stop-Process -Id $process.Id
  Write-Host "Stopped $name (PID $($process.Id))."
}

Stop-RecordedProcess 'TU Scale web development server' $state.web
Stop-RecordedProcess 'TU Scale local AI server' $state.ai
Remove-Item -LiteralPath $stateFile -Force
