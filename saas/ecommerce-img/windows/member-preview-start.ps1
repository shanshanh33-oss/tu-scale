[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$webUrl = 'http://127.0.0.1:5184/member'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$vite = Join-Path $appRoot 'node_modules\vite\bin\vite.js'
$config = Join-Path $PSScriptRoot 'member-preview.vite.config.js'
$logRoot = 'D:\Temp'

if (-not (Test-Path -LiteralPath $vite -PathType Leaf)) { throw 'TU Scale dependencies are missing. Run npm ci in the app directory.' }
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) { throw 'Member preview configuration is missing.' }

function Test-MemberPreview {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5184/api/auth/get-session' -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Headers['Content-Type'] -like 'application/json*'
  } catch { return $false }
}

$listener = Get-NetTCPConnection -LocalPort 5184 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  if (-not $owner -or $owner.CommandLine -notlike "*$appRoot*" -or
      $owner.CommandLine -notlike '*member-preview.vite.config.js*' -or -not (Test-MemberPreview)) {
    throw 'Port 5184 belongs to another service or an unhealthy process. No process was stopped.'
  }
} else {
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  Start-Process -FilePath $node `
    -ArgumentList @($vite, '--config', $config, '--host', '127.0.0.1', '--port', '5184', '--strictPort') `
    -WorkingDirectory $appRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot 'tu-scale-member-preview.out.log') `
    -RedirectStandardError (Join-Path $logRoot 'tu-scale-member-preview.error.log') | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-MemberPreview) { $ready = $true; break }
  }
  if (-not $ready) { throw "Member preview did not start. Check the tu-scale-member-preview logs in $logRoot." }
}

Start-Process $webUrl
Write-Host "TU Scale member preview: $webUrl"
