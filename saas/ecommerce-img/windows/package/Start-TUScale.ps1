$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSCommandPath
$node = Join-Path $root 'runtime\node\node.exe'
$python = Join-Path $root 'runtime\python\python.exe'
$webScript = Join-Path $root 'app\server\windows-static-server.cjs'
$denoiseScript = Join-Path $root 'app\server\windows-denoise-server.cjs'
$appDirectory = Join-Path $root 'app'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'TU Scale\runtime-state'
$logDirectory = Join-Path $env:LOCALAPPDATA 'TU Scale\logs'
$webUrl = 'http://127.0.0.1:5174/'

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

foreach ($required in @($node, $python, $webScript, $denoiseScript, (Join-Path $root 'app\dist\index.html'))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "TU Scale installation is incomplete: $required"
  }
}

function Test-TUScaleWeb {
  try {
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/__tuscale/health' -TimeoutSec 1
    return $result.service -eq 'tuscale-web'
  } catch {
    return $false
  }
}

function Test-TUScaleDenoise {
  try {
    $result = Invoke-RestMethod -Uri 'http://127.0.0.1:5179/denoise/status' -TimeoutSec 1
    return $result.service -eq 'tuscale-denoise'
  } catch {
    return $false
  }
}

if (-not (Test-TUScaleWeb)) {
  $webOut = Join-Path $logDirectory 'web.out.log'
  $webError = Join-Path $logDirectory 'web.error.log'
  $webArgument = '"{0}"' -f $webScript
  $webProcess = Start-Process -FilePath $node -ArgumentList $webArgument -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $webOut -RedirectStandardError $webError
  Set-Content -LiteralPath (Join-Path $stateDirectory 'web.pid') -Value $webProcess.Id -Encoding ASCII
}

$env:TUSCALE_PYTHON = $python
$env:TUSCALE_AI_PORT = '5179'
if (-not (Test-TUScaleDenoise)) {
  $aiOut = Join-Path $logDirectory 'denoise.out.log'
  $aiError = Join-Path $logDirectory 'denoise.error.log'
  $aiArgument = '"{0}"' -f $denoiseScript
  $aiProcess = Start-Process -FilePath $node -ArgumentList $aiArgument -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $aiOut -RedirectStandardError $aiError
  Set-Content -LiteralPath (Join-Path $stateDirectory 'denoise.pid') -Value $aiProcess.Id -Encoding ASCII
}

$webReady = $false
for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
  if (Test-TUScaleWeb) {
    $webReady = $true
    break
  }
  Start-Sleep -Milliseconds 100
}

if (-not $webReady) {
  throw "TU Scale web service did not start. See logs in: $logDirectory"
}

Start-Process $webUrl
