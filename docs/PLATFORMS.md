# Desktop platform support

Windows x64 is the existing release target. macOS Apple Silicon and Linux x64/ARM64 now have native backends and build/release jobs; their first public release requires successful native CI and interactive validation. This Windows development session cannot establish real macOS/Linux installation or account-switching behavior.

| OS | Switcher requirements | Downloads |
| --- | --- | --- |
| Windows | Windows 10/11 x64, WebView2 | NSIS `-setup.exe` |
| macOS | macOS 13+ on Apple Silicon, unlocked login Keychain | `.dmg`; `.app.tar.gz` is the updater archive |
| Linux | GTK 3/WebKitGTK 4.1, graphical session, D-Bus and unlocked Secret Service | x64/ARM64 `.AppImage`, `.deb`, `.rpm` |

Codex must also support your OS version and architecture. Intel macOS is not currently a release target. Linux CI uses Ubuntu 24.04 on both architectures; package formats alone do not establish compatibility with every distribution. GNOME Keyring and Secret Service-enabled KWallet are examples of Linux key stores. Headless machines and desktops without Secret Service are unsupported; there is no plaintext-key fallback.

## Codex setup

Install the official Codex desktop app and open it once. The switcher uses the official Codex CLI for browser sign-in and renewal. It looks for a bundled CLI first, then `codex` on PATH and common CLI install locations on macOS/Linux. Install the official CLI separately if your desktop installation does not expose one.

The switcher manages `auth.json` under `CODEX_HOME`, defaulting to `~/.codex` (`%USERPROFILE%\.codex` on Windows). It supports file credential storage. If your Codex configuration explicitly selects `keyring`, `auto`, or `ephemeral`, set this top-level entry in `config.toml`, fully restart Codex, and sign in there once:

```toml
cli_auth_credentials_store = "file"
```

The switcher does not edit that configuration or override administrator requirements. Managed configurations must permit file storage. Existing running chats may retain their earlier identity. Saved accounts do not automatically synchronize across computers or operating systems.

macOS discovery checks `Codex.app` and `ChatGPT.app` in `/Applications` and `~/Applications`. Linux discovery checks common `/opt` installation directories and `chatgpt` on PATH. For another installation location, launch the switcher with:

```sh
CODEX_DESKTOP_PATH=/absolute/path/to/desktop-executable \
CODEX_CLI_PATH=/absolute/path/to/codex \
chatgpt-account-switcher
```

On macOS, the desktop executable is inside `Contents/MacOS`. These variables are executable paths, not shell commands. `CODEX_HOME`, when set, must be absolute and match Codex's home. Sandboxed Flatpak/Snap installations, wrapper scripts, AppImage editions of Codex itself, and custom launch arguments need separate integration and are not claimed as tested.

## Vault and updates

Windows retains its original `%LOCALAPPDATA%\CodexHarbor` DPAPI vault. macOS uses `~/Library/Application Support/CodexHarbor`; Linux uses `$XDG_DATA_HOME/CodexHarbor`, defaulting to `~/.local/share/CodexHarbor`. macOS/Linux use AES-256-GCM with fresh nonces and a key in the OS credential store. Vault files alone are not portable backups. See [privacy and storage](PRIVACY.md).

Windows, macOS, and the Linux AppImage support signed in-app updates. The Unix app restarts after installation. Install the macOS app in a writable location for updates. Make a Linux AppImage executable before opening it. DEB/RPM installations explain how to install the latest package instead of attempting an AppImage update.

## Development

All platforms need Node.js 20.19+ (CI uses 24) and Rust 1.96.0. Install dependencies with `npm ci`. Windows needs MSVC/C++ Build Tools, the Windows SDK, and WebView2. macOS needs Xcode Command Line Tools (`xcode-select --install`). On Ubuntu 24.04:

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libssl-dev \
  librsvg2-dev libayatana-appindicator3-dev libdbus-1-dev patchelf
```

Run `npm run tauri -- dev`. Package builds use the matching configuration and require an updater signing key because updater artifacts are enabled:

```sh
# macOS
npm run tauri -- build --config src-tauri/tauri.macos.conf.json
# Linux
npm run tauri -- build --config src-tauri/tauri.linux.conf.json
```

The release helper supplies the correct target/configuration and requires the existing updater signing key: `npm run release:build`. Apple Developer ID signing and notarization are separate release requirements; see [release operations](RELEASING.md).

Native tests use synthetic accounts and keys. Unix tests do not read/write the actual system keychain. Process tests create unique copies of `/bin/sleep` and verify that unrelated sessions survive shutdown. macOS/Linux CI installs Chromium for UI tests with `npx playwright install --with-deps chromium`.
