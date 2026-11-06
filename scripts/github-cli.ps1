function Find-GitHubCli {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    # The release setup can install a checksum-verified portable CLI for this Windows user.
    $toolsRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTAccountSwitcher/Tools'
    if (Test-Path -LiteralPath $toolsRoot) {
        $portable = Get-ChildItem -LiteralPath $toolsRoot -Filter gh.exe -Recurse -File |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($portable) { return $portable.FullName }
    }
    throw 'Install GitHub CLI with: winget install --id GitHub.cli --exact. Then run gh auth login.'
}
