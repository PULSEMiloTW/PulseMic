$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configuration = Join-Path $projectRoot '.local\cloudflared.yml'
if (-not (Test-Path -LiteralPath $configuration)) { throw 'Missing .local/cloudflared.yml. See README for dedicated tunnel setup.' }
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) { throw 'Install cloudflared and add it to PATH.' }
Write-Output 'PulseMic dedicated tunnel. Leave this console open; Ctrl+C stops only this tunnel.'
& $cloudflared.Source tunnel --config $configuration run
exit $LASTEXITCODE
