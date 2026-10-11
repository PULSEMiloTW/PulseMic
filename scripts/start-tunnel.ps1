param([switch]$EnsureRunning, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configuration = Join-Path $projectRoot '.local\cloudflared.yml'
if (-not (Test-Path -LiteralPath $configuration)) { throw 'Missing .local/cloudflared.yml. See README for dedicated tunnel setup.' }
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) { throw 'Install cloudflared and add it to PATH.' }
$existing = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($configuration, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match '\btunnel\b.*\brun\b'
}
if ($CheckOnly) { Write-Output 'PulseMic tunnel configuration and executable are available.'; exit 0 }
if ($existing) { Write-Output 'PulseMic dedicated tunnel is already running. Reused the existing process.'; exit 0 }
if ($EnsureRunning) {
  # Use a separate console so the backend CMD remains the actual authorization-code terminal.
  # Windows PowerShell 5.1 reads BOM-less scripts as ANSI; resolve the Unicode filename from disk.
  $launchers = @(Get-ChildItem -LiteralPath $projectRoot -Filter '02_*.cmd' -File)
  if ($launchers.Count -ne 1) { throw 'Expected exactly one 02_ tunnel launcher.' }
  $launcher = $launchers[0].FullName
  Start-Process cmd.exe -WorkingDirectory $projectRoot -WindowStyle Normal -ArgumentList ('/k ""' + $launcher + '""')
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    $started = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object {
      $_.CommandLine -and $_.CommandLine.IndexOf($configuration, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match '\btunnel\b.*\brun\b'
    }
    if ($started) { Write-Output 'PulseMic dedicated tunnel process started.'; exit 0 }
  }
  throw 'Tunnel did not start. Check the dedicated tunnel console.'
}
Write-Output 'PulseMic dedicated tunnel. Leave this console open; Ctrl+C stops only this tunnel.'
& $cloudflared.Source tunnel --config $configuration run
exit $LASTEXITCODE
