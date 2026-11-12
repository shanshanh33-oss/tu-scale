[CmdletBinding()]
param(
  [string]$PythonPath = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$appRoot = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $PSScriptRoot 'requirements-windows.txt'
$venvRoot = Join-Path $appRoot '.venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'

function Normalize-PythonPath {
  param([string]$Value)

  if (-not $Value) { return $null }
  return $Value.Trim().Trim([char[]]@([char]34, [char]39)).Trim()
}

function Test-Python312 {
  param([string]$Candidate)

  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    return $false
  }
  try {
    $version = & $Candidate -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sep=chr(46))' 2>$null
    return $LASTEXITCODE -eq 0 -and ($version | Select-Object -Last 1) -eq '3.12'
  } catch {
    return $false
  }
}

function Resolve-Python312 {
  if ($PythonPath) {
    $explicitPath = Normalize-PythonPath $PythonPath
    if (-not (Test-Python312 $explicitPath)) {
      throw "-PythonPath is not a working Python 3.12 executable: $explicitPath"
    }
    return (Resolve-Path -LiteralPath $explicitPath).Path
  }

  $candidates = @()
  if ($env:TUSCALE_PYTHON) {
    $candidates += Normalize-PythonPath $env:TUSCALE_PYTHON
  }

  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($launcher) {
    try {
      $launcherPath = & $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null
      if ($LASTEXITCODE -eq 0) {
        $candidates += Normalize-PythonPath ($launcherPath | Select-Object -Last 1)
      }
    } catch {
      Write-Verbose 'The Python launcher did not return a usable Python 3.12 path.'
    }
  }

  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $candidates += Normalize-PythonPath $pythonCommand.Source
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-Python312 $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw 'Python 3.12 was not found. Pass its full path with -PythonPath.'
}

function Test-VenvPython {
  if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    return $false
  }
  try {
    $version = & $venvPython -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sep=chr(46))' 2>$null
    return $LASTEXITCODE -eq 0 -and ($version | Select-Object -Last 1) -eq '3.12'
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) {
  throw "Windows Python requirements are missing: $requirements"
}

$basePython = Resolve-Python312
Write-Host "Using Python 3.12: $basePython"

if (-not (Test-VenvPython)) {
  $expectedVenv = [IO.Path]::GetFullPath((Join-Path $appRoot '.venv')).TrimEnd('\')
  $actualVenv = [IO.Path]::GetFullPath($venvRoot).TrimEnd('\')
  if (-not $actualVenv.Equals($expectedVenv, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to rebuild an unexpected virtual environment path: $actualVenv"
  }

  if (Test-Path -LiteralPath $venvRoot) {
    Write-Warning "The project virtual environment is unusable and will be rebuilt: $venvRoot"
    Remove-Item -LiteralPath $venvRoot -Recurse -Force
  }

  & $basePython -m venv $venvRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-VenvPython)) {
    throw 'Python created the virtual environment, but its interpreter is not usable.'
  }
}

if (-not $env:PIP_CACHE_DIR) {
  $driveRoot = [IO.Path]::GetPathRoot($appRoot)
  $env:PIP_CACHE_DIR = Join-Path $driveRoot 'Caches\pip'
}
New-Item -ItemType Directory -Force -Path $env:PIP_CACHE_DIR | Out-Null
Write-Host "Using pip cache: $env:PIP_CACHE_DIR"

& $venvPython -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) {
  throw 'Windows Python dependency installation failed.'
}

& $venvPython -c 'import numpy; import onnxruntime; from PIL import Image'
if ($LASTEXITCODE -ne 0) {
  throw 'Windows Python dependencies were installed, but the import check failed.'
}

Write-Host "Virtual environment ready: $venvRoot"
