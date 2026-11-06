# Release operations

The configured repository is `nickfouf/ChatGPTAccountSwitcher`. The stable update endpoint is `https://github.com/nickfouf/ChatGPTAccountSwitcher/releases/latest/download/latest.json`.

Release targets are Windows x64 (NSIS), macOS Apple Silicon (DMG and signed app archive), and Linux x64/ARM64 (AppImage, DEB, and RPM). The new macOS/Linux targets require native installation and switching validation before their first publication. Keep `local.codexharbor.desktop`, the Windows vault location, and its DPAPI entropy stable: existing installations rely on those identities to upgrade and read saved accounts.

## First GitHub publication

Local builds do not publish anything. Publication uses [GitHub CLI](https://cli.github.com/) and its OS credential store; no personal GitHub token needs to be kept in this project. Install and authenticate on a new development machine:

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

On this machine, the authenticated GitHub CLI is stored under `%LOCALAPPDATA%\ChatGPTAccountSwitcher\Tools`; the setup and publication helpers discover it automatically. Authentication remains in the OS credential store. Once changes are reviewed and committed on `main`, publish the app version with:

```powershell
npm run release:publish
```

This validates versions and a clean working tree, creates the matching tag, pushes source and tag, waits for the Release workflow, checks the expected release assets, and publishes its completed draft. A failed check or build stops publication. It does not commit changes for you or overwrite an existing version tag pointing at different source.

To prepare a new release:

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

The Release workflow checks the tagged source, rejects mismatched versions, builds and signs all four platform updater packages, merges their manifests and license notices, and uploads assets to a **draft GitHub release**. Only the final upload job receives repository write permission. Platform build jobs receive the updater signing secret; macOS can also receive Apple signing/notarization secrets. Pull-request jobs cannot access these secrets. Workflow actions are pinned to commit hashes.

Open the draft, review its notes and installer, and select **Publish release**. Only published stable releases are delivered through `/releases/latest/`. Drafts and prereleases do not interrupt users. Keep older releases available for history and manual downloads.

Rerun a failed draft through Actions → Release → Run workflow → existing tag. The workflow refuses to replace published release assets. Fix an already published version by issuing a higher version.

## Local installer build

```powershell
npm ci
npm run release:build
```

The ignored local `.env` sets `TAURI_SIGNING_PRIVATE_KEY` to the external key file path. The key itself stays outside the repository; no GitHub token is stored in `.env`. Release scripts load this file automatically. Existing process variables take precedence, so GitHub Actions uses its encrypted secret. On a new machine, copy `.env.example` to `.env` and point it at the restored key, or omit the setting to use the default external key location.

Output in ignored `release/`:

- `*-setup.exe`: Windows x64 per-user installer.
- `*-setup.exe.sig`: updater signature.
- `latest.json`: version, full changelog, publication time, signed installer URL.
- `SHA256SUMS.txt`: checksums of the installer, signature, manifest, and notices.
- `release-notes.md`: current version's GitHub description.
- `LICENSE.txt` and `FONT-LICENSES.txt`: distribution notices.
- `THIRD-PARTY-LICENSES.txt`: notices for locked production libraries, also embedded in app assets.

The local manifest points to the matching repository tag. It only becomes usable after those exact assets are published there. Local builds never publish automatically.

Release asset names use the stable ASCII package name (for example, `chatgpt-account-switcher_0.1.1_x64-setup.exe`) so GitHub does not normalize them into different download URLs. The build verifies the actual installer against the embedded public key and its signed version and confirms that a modified installer is rejected. The publishing helper repeats verification on the uploaded assets before publishing, including URL and checksum checks. Existing installations require the signed version field, protecting against a manifest announcing a new version while serving an old signed installer.

## Interactive release verification

Use a disposable user or VM on each target OS:

1. Install the previous build and launch it with test accounts.
2. Publish the next stable release; confirm update discovery and every intermediate changelog section.
3. Choose Later and verify continued use and update availability.
4. Choose Update and restart; verify progress, installer handoff, relaunch, new version, and welcome notes.
5. Confirm saved accounts and preferences survive. Check Start menu launch, uninstall through Windows Settings, and reinstall.
6. Test unavailable networking and an invalid signature in an isolated test repository. Never alter a production release for testing.

Automated tests exercise the interface and native operation gating. They do not install updates or change real Codex credentials. A full online update test requires two published versions and interactive installation; a successful local build alone does not establish that result.

## macOS and Linux release builds

`npm run release:build` selects the current host OS and architecture. `RELEASE_TARGET` selects one of the four supported Rust triples in `scripts/release-targets.mjs`. macOS and Linux builds apply their Tauri configuration overlays automatically. `BUNDLE_DIR` is intended for manifest fixtures; normal builds include DMG or DEB/RPM downloads as well as updater archives. Windows asset names and the existing updater signing identity remain stable.

GitHub Actions builds all targets on native runners. Each job uploads its partial manifest under its updater platform ID. The final job runs `node scripts/release.mjs merge`, refuses missing platforms or corrupted assets, and verifies every update against the embedded public key and signed version. `node scripts/release.mjs verify --all` requires the complete desktop release; the publication helper uses it before publishing. Partial manifests are only for local builds and are never uploaded as the stable combined manifest.

For public macOS distribution, configure repository secrets `APPLE_CERTIFICATE` (base64 Developer ID certificate), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID`. Without Apple signing configuration, macOS output is a development build and may be blocked by Gatekeeper. Updater signatures are separate from Apple signing/notarization. Never claim a development build is notarized.

Linux AppImages support the signed in-app updater. DEB/RPM installations use the system package manager to install a newly downloaded package; the interface explains this and opens GitHub Releases. The Linux desktop requires an unlocked Secret Service provider. Validate first login, removal, switching, rollback, system language, installation, upgrade, and uninstall on macOS and both Linux architectures before publishing support claims. Automated tests use synthetic vault data and never operate real Codex sessions.
