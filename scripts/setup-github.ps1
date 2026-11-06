[CmdletBinding()]
param(
    [string]$Repository = 'nickfouf/ChatGPTAccountSwitcher',
    [switch]$CreateRepository
)
$ErrorActionPreference = 'Stop'
if ($Repository -notmatch '^[\w.-]+/[\w.-]+$') { throw 'Expected owner/repository.' }
. (Join-Path $PSScriptRoot 'github-cli.ps1')
$ghExe = Find-GitHubCli
& $ghExe auth status
if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login, then rerun this script.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $keyFile = Join-Path $env:USERPROFILE '.chatgpt-account-switcher/keys/updater.key'
    if (!(Test-Path -LiteralPath $keyFile)) { throw 'Restore the matching private signing key before setting up releases.' }
    & npm run release:validate
    if ($LASTEXITCODE -ne 0) { throw 'Release validation failed.' }
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $expectedEndpoint = "https://github.com/$Repository/releases/latest/download/latest.json"
    if ($config.plugins.updater.endpoints[0] -ne $expectedEndpoint) { throw 'The repository must match the configured updater endpoint.' }
    if (!(Test-Path -LiteralPath "$keyFile.pub")) { throw 'Restore the matching public key file beside the private key.' }
    if ((Get-Content -LiteralPath "$keyFile.pub" -Raw).Trim() -ne $config.plugins.updater.pubkey) { throw 'The local signing identity does not match the app public key.' }
    & $ghExe repo view $Repository --json nameWithOwner 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        if (!$CreateRepository) { throw 'Repository not found. Rerun with -CreateRepository to create the configured public repository.' }
        & $ghExe repo create $Repository --public --description 'A Windows companion for saving and switching Codex accounts, with encrypted storage and signed updates.'
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the public repository.' }
    }
    # Reading from a file keeps the key out of arguments, shell history, and logs.
    $secretProcess = Start-Process -FilePath $ghExe -ArgumentList @('secret','set','TAURI_SIGNING_PRIVATE_KEY','--repo',$Repository) -RedirectStandardInput $keyFile -WindowStyle Hidden -Wait -PassThru
    if ($secretProcess.ExitCode -ne 0) { throw 'Could not upload the signing secret. Check repository access.' }
    Write-Host "Release signing configured for $Repository."
    Write-Host 'Back up the private key securely; GitHub secrets cannot be downloaded later.'
    Write-Host 'No source or release has been pushed. Follow docs/RELEASING.md to push main and tag v0.1.0.'
} finally { Pop-Location }
