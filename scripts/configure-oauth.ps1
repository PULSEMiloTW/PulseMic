$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$clientId = Read-Host 'Discord OAuth Application ID (17-20 digits)'
if ($clientId -notmatch '^\d{17,20}$') { throw 'Invalid Application ID.' }
$secureSecret = Read-Host 'Discord OAuth Client Secret (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($clientSecret.Length -lt 16 -or $clientSecret.Length -gt 256) { throw 'Invalid Client Secret.' }
  $json = @{ clientId = $clientId; clientSecret = $clientSecret } | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $directory = Join-Path $env:LOCALAPPDATA 'PulseMic'
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ([Guid]::NewGuid().ToString() + '.secrets')
  [IO.File]::WriteAllText($temporary, [Convert]::ToBase64String($protected))
  Move-Item -LiteralPath $temporary -Destination (Join-Path $directory 'oauth.secrets') -Force
  Write-Output 'OAuth configuration saved with Windows CurrentUser encryption. Restart PulseMic to apply.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $clientSecret = $null
  $json = $null
}
