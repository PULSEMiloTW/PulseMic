param([switch]$CheckOnly, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Please install Node.js 22.12+ (recommended Node.js 24 LTS), then open the launcher again.' }
$nodeVersion = (& node -p 'process.versions.node').Split('.')
if ([int]$nodeVersion[0] -lt 22 -or ([int]$nodeVersion[0] -eq 22 -and [int]$nodeVersion[1] -lt 12)) { throw 'Node.js 22.12+ is required.' }
$localPort = 3210
if ($env:PULSEMIC_PORT) { $localPort = [int]$env:PULSEMIC_PORT }
$controlUrl = "http://localhost:$localPort/console"
function Test-PulseMic {
  try {
    # Probe the exact IPv4 bind; Windows can otherwise wait on localhost's IPv6 address.
    $health = Invoke-RestMethod "http://127.0.0.1:$localPort/api/health" -TimeoutSec 3
    return $health.app -eq 'PulseMic'
  } catch { return $false }
}
if (Test-PulseMic) {
  if ($PrepareOnly -and -not $CheckOnly) { Write-Output "PulseMic is already running. Reused the local service."; exit 3 }
  if (-not $CheckOnly) { Start-Process $controlUrl }
  Write-Output 'PulseMic is already running. Reused the local service.'
  exit 0
}
$listener = Get-NetTCPConnection -State Listen -LocalPort $localPort -ErrorAction SilentlyContinue
if ($listener) { throw "Port $localPort is in use by another application. Set PULSEMIC_PORT to another local port." }
$lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
$installedHash = ''
if (Test-Path -LiteralPath '.local/dependencies.sha256') { $installedHash = (Get-Content -LiteralPath '.local/dependencies.sha256' -Raw).Trim() }
if (-not (Test-Path -LiteralPath 'node_modules/.package-lock.json') -or $installedHash -ne $lockHash) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  New-Item -ItemType Directory -Force -Path '.local' | Out-Null
  Set-Content -LiteralPath '.local/dependencies.sha256' -Value $lockHash -Encoding ASCII
}
# Rebuild on each fresh launch so updates cannot silently use yesterday's bundle.
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the errors above.' }
if ($CheckOnly) { Write-Output 'PulseMic launcher preflight passed.'; exit 0 }
if ($PrepareOnly) { Write-Output "PulseMic is ready for CMD startup."; exit 0 }
$browserHelper = "Start-Sleep -Seconds 3; Start-Process '$controlUrl'"
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', $browserHelper)
Write-Output 'Leave this console open. Press Ctrl+C to stop PulseMic.'
& node dist/server/server/index.js
exit $LASTEXITCODE
