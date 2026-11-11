[CmdletBinding()]
param(
  [switch]$SkipAi
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$appRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$viteScript = Join-Path $appRoot 'node_modules\vite\bin\vite.js'
$aiScript = Join-Path $appRoot 'windows\server\windows-denoise-server.cjs'
$stateDirectory = Join-Path $env:LOCALAPPDATA 'TU Scale Dev'
$stateFile = Join-Path $stateDirectory 'runtime-state.json'
$logDirectory = Join-Path $stateDirectory 'logs'
$webUrl = 'http://127.0.0.1:5174/'

if (-not $nodeCommand) {
  throw 'Node.js was not found. Install Node.js 22 LTS, reopen PowerShell, and try again.'
}
if (-not (Test-Path -LiteralPath $viteScript -PathType Leaf)) {
  throw "Development dependencies are missing. Run 'npm ci' in: $appRoot"
}
if (-not (Test-Path -LiteralPath $aiScript -PathType Leaf)) {
  throw "Windows AI server source is missing: $aiScript"
}

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Test-TUScaleWeb {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $webUrl -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-TUScaleAi {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:5179/denoise/status' -TimeoutSec 1
    return $response.service -eq 'tuscale-denoise'
  } catch {
    return $false
  }
}

function Resolve-Python {
  if ($env:TUSCALE_PYTHON) {
    if (Test-Path -LiteralPath $env:TUSCALE_PYTHON -PathType Leaf) {
      return (Resolve-Path -LiteralPath $env:TUSCALE_PYTHON).Path
    }
    $configured = Get-Command $env:TUSCALE_PYTHON -ErrorAction SilentlyContinue
    if ($configured) { return $configured.Source }
  }

  $venvPython = Join-Path $appRoot '.venv\Scripts\python.exe'
  if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
    return (Resolve-Path -LiteralPath $venvPython).Path
  }

  foreach ($name in @('python.exe', 'python')) {
    $candidate = Get-Command $name -ErrorAction SilentlyContinue
    if ($candidate) { return $candidate.Source }
  }
  return $null
}

function Get-ProcessRecord($process) {
  return [ordered]@{
    pid = $process.Id
    startTimeUtcFileTime = [string]$process.StartTime.ToUniversalTime().ToFileTimeUtc()
  }
}

$state = [ordered]@{
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  appRoot = $appRoot
}
if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
  try {
    $existingState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($existingState.web) { $state.web = $existingState.web }
    if ($existingState.ai) { $state.ai = $existingState.ai }
  } catch {
    Write-Warning 'The previous development process record was invalid and will be replaced.'
  }
}

if (-not (Test-TUScaleWeb)) {
  $webOut = Join-Path $logDirectory 'web.out.log'
  $webError = Join-Path $logDirectory 'web.error.log'
  $webProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList @($viteScript, '--host', '127.0.0.1', '--port', '5174', '--strictPort') `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $webOut `
    -RedirectStandardError $webError
  $state.web = Get-ProcessRecord $webProcess
}

if (-not $SkipAi -and -not (Test-TUScaleAi)) {
  $python = Resolve-Python
  $pythonReady = $false
  if ($python) {
    & $python -c 'import numpy; import onnxruntime; from PIL import Image' 2>$null
    $pythonReady = $LASTEXITCODE -eq 0
  }

  if ($pythonReady) {
    $aiOut = Join-Path $logDirectory 'ai.out.log'
    $aiError = Join-Path $logDirectory 'ai.error.log'
    $previousAppRoot = $env:TUSCALE_APP_ROOT
    $previousServerRoot = $env:TUSCALE_SERVER_DIR
    $previousPython = $env:TUSCALE_PYTHON
    $previousPort = $env:TUSCALE_AI_PORT
    try {
      $env:TUSCALE_APP_ROOT = $appRoot
      $env:TUSCALE_SERVER_DIR = Join-Path $appRoot 'server'
      $env:TUSCALE_PYTHON = $python
      $env:TUSCALE_AI_PORT = '5179'
      $aiProcess = Start-Process `
        -FilePath $nodeCommand.Source `
        -ArgumentList @($aiScript) `
        -WorkingDirectory $appRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $aiOut `
        -RedirectStandardError $aiError
      $state.ai = Get-ProcessRecord $aiProcess
    } finally {
      $env:TUSCALE_APP_ROOT = $previousAppRoot
      $env:TUSCALE_SERVER_DIR = $previousServerRoot
      $env:TUSCALE_PYTHON = $previousPython
      $env:TUSCALE_AI_PORT = $previousPort
    }
  } else {
    Write-Warning "Python AI dependencies are unavailable. The web app will use browser AI. See windows\README.md for optional AI setup."
  }
}

$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

$webReady = $false
for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
  if (Test-TUScaleWeb) {
    $webReady = $true
    break
  }
  Start-Sleep -Milliseconds 100
}
if (-not $webReady) {
  throw "TU Scale development server did not start. See logs in: $logDirectory"
}

if (-not $SkipAi -and $state.ai) {
  $aiReady = $false
  for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
    if (Test-TUScaleAi) {
      $aiReady = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $aiReady) {
    Write-Warning "The local AI service did not start. Browser AI remains available. See logs in: $logDirectory"
  }
}

Write-Host "TU Scale development site: $webUrl"
Write-Host "Development logs: $logDirectory"
Write-Host "Stop services with: powershell -ExecutionPolicy Bypass -File .\windows\dev-stop.ps1"
Start-Process $webUrl
