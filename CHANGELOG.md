# Changelog

All notable changes are documented here. Versions follow Semantic Versioning.
Release dates use YYYY-MM-DD. Keep newest releases first; the app uses these
sections to show every change since the installed version.

## [0.1.0] - 2026-11-05

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
