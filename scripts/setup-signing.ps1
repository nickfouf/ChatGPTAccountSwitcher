[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $keyDir = Join-Path $env:USERPROFILE '.chatgpt-account-switcher/keys'
    $keyFile = Join-Path $keyDir 'updater.key'
    if (Test-Path -LiteralPath $keyFile) {
        Write-Host "Existing signing key retained: $keyFile"
        Write-Host 'Never regenerate or replace a key used by published builds.'
        exit 0
    }
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    if ($config.plugins.updater.pubkey) {
        throw 'This project already has a public signing key. Restore its matching private key, or deliberately configure a NEW signing identity for your fork before generating one.'
    }
    New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    & npm run tauri -- signer generate --ci -w $keyFile
    if ($LASTEXITCODE -ne 0) { throw 'Key generation failed.' }
    $keyOwner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $keyFile /inheritance:r /grant:r "*${keyOwner}:F" '*S-1-5-18:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict private key access.' }
    $config.plugins.updater.pubkey = (Get-Content -LiteralPath "$keyFile.pub" -Raw).Trim()
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath 'src-tauri/tauri.conf.json' -Encoding utf8
    Write-Host "Private key saved outside the repository: $keyFile"
    Write-Host 'Back it up securely. Upload its content as TAURI_SIGNING_PRIVATE_KEY using scripts/setup-github.ps1.'
} finally { Pop-Location }
