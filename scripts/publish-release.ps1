[CmdletBinding()]
param([string]$Tag)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'github-cli.ps1')
$ghExe = Find-GitHubCli
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $versionTag = 'v' + $config.version
    if (!$Tag) { $Tag = $versionTag }
    if ($Tag -notmatch '^v\d+\.\d+\.\d+$' -or $Tag -ne $versionTag) { throw 'The release tag must match the current stable app version.' }
    $endpoint = $config.plugins.updater.endpoints[0]
    if ($endpoint -notmatch '^https://github\.com/([\w.-]+/[\w.-]+)/releases/latest/download/latest\.json$') { throw 'Expected a GitHub Releases updater endpoint.' }
    $repository = $Matches[1]
    & $ghExe auth status
    if ($LASTEXITCODE -ne 0) { throw 'Sign into GitHub CLI before publishing.' }
    & npm run release:validate -- $Tag
    if ($LASTEXITCODE -ne 0) { throw 'Release validation failed.' }
    $dirty = git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Review and commit local changes before publishing.' }
    $branch = git branch --show-current
    if ($branch -ne 'main') { throw 'Publish stable releases from main.' }
    $origin = git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $origin -notin @("https://github.com/$repository.git", "https://github.com/$repository", "git@github.com:$repository.git")) { throw 'Git origin must match the configured release repository.' }
    $commit = git rev-parse HEAD
    $existingTag = git tag --list $Tag
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect local release tags.' }
    if ($existingTag) {
        $tagCommit = git rev-list -n 1 $Tag
        if ($tagCommit -ne $commit) { throw 'The version tag already refers to a different commit. Use a new version.' }
    } else {
        git tag -a $Tag -m "Release $Tag"
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the release tag.' }
    }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not push main.' }
    git push origin "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) { throw 'Could not push the version tag.' }
    $run = $null
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        $runs = & $ghExe run list --repo $repository --workflow release.yml --commit $commit --json databaseId,status,conclusion --limit 10
        if ($LASTEXITCODE -eq 0) { $run = @($runs | ConvertFrom-Json) | Select-Object -First 1 }
        if ($run) { break }
        Start-Sleep -Seconds 3
    }
    if (!$run) { throw 'The Release workflow has not appeared yet. Rerun this command after GitHub queues it.' }
    & $ghExe run watch $run.databaseId --repo $repository --exit-status --interval 10
    if ($LASTEXITCODE -ne 0) { throw 'The release workflow failed. Inspect its logs before publishing.' }
    $releaseJson = & $ghExe release view $Tag --repo $repository --json isDraft,tagName,assets,url
    if ($LASTEXITCODE -ne 0) { throw 'The workflow did not produce a release.' }
    $release = $releaseJson | ConvertFrom-Json
    $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
    $expectedInstaller = "$($package.name)_$($config.version)_x64-setup.exe"
    foreach ($name in @($expectedInstaller, "$expectedInstaller.sig", 'latest.json', 'SHA256SUMS.txt', 'LICENSE.txt', 'FONT-LICENSES.txt', 'THIRD-PARTY-LICENSES.txt')) {
        if ($name -notin $release.assets.name) { throw "Release asset is missing: $name" }
    }
    if ($release.isDraft) {
        & $ghExe release download $Tag --repo $repository --dir release --clobber
        if ($LASTEXITCODE -ne 0) { throw 'Could not download the uploaded release for verification.' }
        & node scripts/release.mjs verify
        if ($LASTEXITCODE -ne 0) { throw 'The downloaded manifest or checksums failed verification.' }
        & cargo run --locked --manifest-path src-tauri/Cargo.toml --example verify_release --release --target x86_64-pc-windows-msvc -- src-tauri/tauri.conf.json release/latest.json
        if ($LASTEXITCODE -ne 0) { throw 'The downloaded installer signature failed verification.' }
        & $ghExe release edit $Tag --repo $repository --draft=false --latest
        if ($LASTEXITCODE -ne 0) { throw 'Could not publish the verified draft release.' }
    }
    Write-Host "Published $($release.url)"
} finally { Pop-Location }
