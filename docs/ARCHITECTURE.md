# Architecture

Vite builds local assets from `ui/`; Tauri loads them in WebView2. Fonts are bundled. The content security policy restricts webview network access. Rust owns account requests and update downloads.

`main.js` renders account cards and dispatches explicit account actions. `updates.js` owns a separate modal host so background snapshots cannot reset update progress. Marked renders release Markdown and DOMPurify restricts it to text-formatting elements. `CHANGELOG.md` supplies both remote cumulative notes and post-update welcome notes.

`core.rs` owns the encrypted vault, identity checks, recovery journal, token renewal, browser login, exclusions, and usage snapshots. `windows.rs` implements Windows DPAPI and Codex process integration. `runtime.rs` watches live authentication files and publishes snapshots. The vault path, identifier, and entropy deliberately retain their original CodexHarbor identity for compatibility.

`updates.rs` uses the official Tauri updater plugin. The frontend receives only versions, dates, notes, and progress; it cannot provide arbitrary download URLs or installer paths. A native gate serializes account mutations and installation. Installation rejects active browser sign-in. The window handler prevents closing during protected operations.

Update manifests and installer downloads require HTTPS. Tauri compares versions and verifies downloaded signatures against the embedded public key. Check requests have a 30-second timeout; downloads allow ten minutes. Generic errors avoid exposing native diagnostic details. On Windows, verified installer handoff exits and relaunches the app.

The manifest includes structured stable-version changelog sections. The UI displays sections greater than the installed version and no greater than the available version. The bundled history provides welcome notes after upgrading across skipped versions.

`scripts/release.mjs` validates versions, prepares version bumps, builds signed NSIS installers, and generates release assets. GitHub Actions validates tagged source before creating a draft release. Publishing the draft makes it available to installed users. No separate update server is needed. The app is Windows-specific; no macOS or Linux installers are built.
