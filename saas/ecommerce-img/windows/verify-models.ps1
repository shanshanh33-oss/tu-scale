[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $PSScriptRoot 'model-checksums.sha256'
$failed = $false

if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
  throw "Model checksum manifest is missing: $manifest"
}

foreach ($line in Get-Content -LiteralPath $manifest) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
  $parts = $trimmed -split '\s+', 2
  if ($parts.Count -ne 2) {
    Write-Error "Invalid checksum line: $line"
    $failed = $true
    continue
  }

  $expected = $parts[0].ToLowerInvariant()
  $relativePath = $parts[1].Replace('/', '\')
  $modelPath = Join-Path $appRoot $relativePath
  if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) {
    Write-Error "Missing model file: $relativePath"
    $failed = $true
    continue
  }

  $actual = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Write-Error "Checksum mismatch: $relativePath"
    $failed = $true
  } else {
    Write-Host "OK  $relativePath"
  }
}

if ($failed) { exit 1 }
Write-Host 'All TU Scale local AI model checksums passed.'
