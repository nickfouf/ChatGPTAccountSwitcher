# Release operations

The configured repository is `nickfouf/ChatGPTAccountSwitcher`. The stable update endpoint is `https://github.com/nickfouf/ChatGPTAccountSwitcher/releases/latest/download/latest.json`.

The supported target is Windows 10/11 x64 with a per-user NSIS installer. Keep `local.codexharbor.desktop`, the vault location, and its DPAPI entropy stable: existing installations rely on those identities to upgrade and read saved accounts.

## First GitHub publication

The source is prepared locally; local builds do not publish anything. Install [GitHub CLI](https://cli.github.com/) and authenticate:

```powershell
winget install --id GitHub.cli --exact
gh auth login
```

Open a new terminal after installation if `gh` is not found. This helper creates the empty public repository and configures its signing secret after validating the local public key:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-github.ps1 -CreateRepository
```

The local Git repository and `origin` remote may already be prepared. Inspect them with `git status` and `git remote -v`. If starting from a downloaded source archive, initialize them as follows; skip initialization, commit, or remote creation when they already exist:

```powershell
git init -b main
git add .
git diff --cached --stat
git diff --cached
git commit -m "Prepare public release with installer and signed updates"
git remote add origin https://github.com/nickfouf/ChatGPTAccountSwitcher.git
git push -u origin main
```

Review staged files before committing. Ignore rules exclude signing keys, environment files, auth files, build output, test artifacts, editor settings, and generated Tauri schemas. Only the public signing key belongs in Git. Enable GitHub secret scanning, push protection, and private vulnerability reporting in repository settings where available. Do not commit or tag while another agent is still editing the shared folder.

## Signing identity

A signing identity has already been generated on the original development machine:

```text
%USERPROFILE%\.chatgpt-account-switcher\keys\updater.key
%USERPROFILE%\.chatgpt-account-switcher\keys\updater.key.pub
```

Only the public key is embedded in `src-tauri/tauri.conf.json`. **Back up the private key securely before distributing the first release.** Losing it prevents future builds from updating installations that trust the current key. Never upload it to source control, release assets, issues, screenshots, or chats.

If the repository already exists, configure GitHub's encrypted repository secret without printing the key:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-github.ps1
```

This requires an existing repository and authenticated GitHub CLI with repository access. The script sets `TAURI_SIGNING_PRIVATE_KEY` from the external key file. The generated key is unencrypted; restrict access to the file and GitHub secret. For a password-protected key, also configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and export it for local builds.

`npm run signing:setup` retains existing keys and refuses to replace an established signing identity. On another machine, restore the matching private key. A fork must deliberately clear the public key, generate its own identity, and change the updater endpoint and repository metadata before distributing installers. Never change the signing key for existing users without a migration plan.

Update signing is distinct from Authenticode. It authenticates downloaded installers to this app; a Windows code signing certificate identifies the publisher to Windows. This project currently configures only update signing, so Windows may show an unknown-publisher warning. An Authenticode certificate must be obtained separately and configured through Tauri's Windows signing options.

## Release a new version

For the first release, retain `0.1.0`. For later releases:

```powershell
npm run version:prepare -- 0.2.0
```

This updates npm, Cargo, their lockfiles, the Tauri version, and adds a dated changelog section. Replace its placeholder with user-visible changes. Keep headings exactly `## [x.y.z] - YYYY-MM-DD`, newest first. The updater manifest includes the history so the dialog can show changes across skipped versions.

```powershell
npm run release:validate
npm run test:release
npm run build
npm test
npm run test:rust
npm run lint:rust
npm run format:check
git add .
git commit -m "Release v0.2.0"
git push
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

Use `v0.1.0` for the initial release. The Release workflow checks the tagged source, rejects mismatched versions, builds and signs the installer, generates the updater manifest and checksums, and uploads assets to a **draft GitHub release**. Only the upload job receives write permissions and the signing secret. Pull-request jobs cannot access it. Workflow actions are pinned to commit hashes.

Open the draft, review its notes and installer, and select **Publish release**. Only published stable releases are delivered through `/releases/latest/`. Drafts and prereleases do not interrupt users. Keep older releases available for history and manual downloads.

Rerun a failed draft through Actions → Release → Run workflow → existing tag. The workflow refuses to replace published release assets. Fix an already published version by issuing a higher version.

## Local installer build

```powershell
npm ci
npm run release:build
```

The build uses the existing key outside the source directory, or `TAURI_SIGNING_PRIVATE_KEY` if provided. Output in ignored `release/`:

- `*-setup.exe`: Windows x64 per-user installer.
- `*-setup.exe.sig`: updater signature.
- `latest.json`: version, full changelog, publication time, signed installer URL.
- `SHA256SUMS.txt`: checksums of the installer, signature, manifest, and notices.
- `release-notes.md`: current version's GitHub description.
- `LICENSE.txt` and `FONT-LICENSES.txt`: distribution notices.
- `THIRD-PARTY-LICENSES.txt`: notices for locked production libraries, also embedded in app assets.

The local manifest points to the matching repository tag. It only becomes usable after those exact assets are published there. Local builds never publish automatically.

The build also verifies the actual installer against the embedded public key and its signed version, and confirms that a modified installer is rejected. Existing installations require the signed version field, protecting against a manifest announcing a new version while serving an old signed installer.

## Interactive release verification

Use a disposable Windows user or VM:

1. Install the previous build and launch it with test accounts.
2. Publish the next stable release; confirm update discovery and every intermediate changelog section.
3. Choose Later and verify continued use and update availability.
4. Choose Update and restart; verify progress, installer handoff, relaunch, new version, and welcome notes.
5. Confirm saved accounts and preferences survive. Check Start menu launch, uninstall through Windows Settings, and reinstall.
6. Test unavailable networking and an invalid signature in an isolated test repository. Never alter a production release for testing.

Automated tests exercise the interface and native operation gating. They do not install updates or change real Codex credentials. A full online update test requires two published versions and interactive installation; a successful local build alone does not establish that result.
