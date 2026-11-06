# Changelog

All notable changes are documented here. Versions follow Semantic Versioning.
Release dates use YYYY-MM-DD. Keep newest releases first; the app uses these
sections to show every change since the installed version.

## [0.2.0] - 2026-11-06

### Added
- Experimental macOS Apple Silicon and Linux x64/ARM64 desktop backends with OS-protected vault encryption keys.
- Platform installers, signed updater packages, combined release manifests, and native CI jobs.
- Credential-storage checks that refuse unsupported Codex storage before switching.
- Linux package update guidance and app restarts after macOS/AppImage updates.

## [0.1.2] - 2026-11-06

### Changed
- Support all 32 app languages in the Windows installer and uninstaller.
- Default the installer language selector to the Windows language on first use and remember manual choices for maintenance.
- Translate all installer-specific WebView2, running-app, repair, and uninstall messages.
- Check installer/app language parity, complete messages, and preserved variables before release builds.

## [0.1.1] - 2026-11-06

### Changed
- Use stable installer filenames in GitHub Releases so updater download URLs match uploaded assets.
- Verify downloaded manifest, checksums, and installer signatures before publishing.

## [0.1.0] - 2026-11-06

### Added
- Save and switch Codex accounts using encrypted storage for the current Windows user.
- Sign in through the official Codex browser flow and see account usage at a glance.
- Interfaces in 32 languages, Windows display-language detection, right-to-left layouts, and an interactive first-run guide.
- Windows installer with Start menu shortcuts, an uninstaller, and WebView2 setup.
- Automatic app update checks, signed downloads, progress feedback, and release notes for skipped versions.
- An optional automatic update check setting and a manual check in Settings.
- A welcome dialog showing what changed after an app update.
- GitHub Actions validation and a repeatable signed release pipeline.

### Security
- Verify every app update against the embedded public signing key before installation.
- Keep account credentials in the native process and out of update requests and UI messages.
- Prevent app installation while an account action or browser sign-in is in progress.
