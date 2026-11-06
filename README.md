# ChatGPT Account Switcher

A Windows companion for saving and switching Codex accounts, with encrypted local storage, usage summaries, a guided tour, and signed app updates.

**Independent community project. Not affiliated with, endorsed by, or supported by OpenAI.** ChatGPT, Codex, and OpenAI are trademarks of their respective owners.

## Install

Download the latest **-setup.exe** from [GitHub Releases](https://github.com/nickfouf/ChatGPTAccountSwitcher/releases/latest). The per-user installer adds a Start menu shortcut and uninstaller and installs Microsoft WebView2 if missing. Supported release target: Windows 10/11 x64.

Update packages have cryptographic signatures, but the installer currently has **no Windows Authenticode certificate**. Windows may identify it as an unknown publisher.

Install and open the official Windows Codex app at least once. This application does not install Codex.

## Use

- Open the app to see the current Codex account. An unfamiliar live account is saved automatically.
- Choose **Add account** for official browser sign-in. The current Codex account stays connected during login.
- Choose **Switch account** after saving your work. Credentials are checked and renewed when possible, then Codex closes and reopens with the selected account.
- Choose **Remove** to delete an account saved by this app. This does not sign out Codex or delete chats.
- Open **Settings** for language preferences, the installed version, and **Check for updates**. Replay the guided tour from the help button.

The interface offers 32 language options. **Use PC language** is the default: it follows Windows display-language preferences, with English as the fallback for unsupported languages. You can select a specific language in Settings or return to the PC setting at any time. Explicit language choices are kept between launches. Dates use the selected locale, and Arabic, Hebrew, and Persian use a right-to-left layout. See [language support](docs/LANGUAGES.md) for the full list and translation guidance.

The installer and uninstaller support the same 32 languages, defaulting to the Windows language on first use. The installer remembers a manual selection for maintenance and uninstall.

Codex behavior and authentication interfaces may change. Browser login and switching a real running Codex session require interactive validation. The current-account marker identifies the live auth-file identity; an already created chat may retain its previous session.

## App updates

The app checks GitHub Releases at startup and every six hours while running. Checks wait for the guided tour and account actions. Automatic checks can be disabled in Settings; manual checks remain available.

The update dialog shows installed and available versions and the changes across skipped versions. Choose **Later** to keep working, or **Update and restart** to download, verify, and install. Progress is displayed, conflicting account actions are blocked, and the installer reopens the app. Failed checks or downloads leave the current version usable. A welcome dialog shows the bundled changes after a version upgrade.

Update requests go to GitHub and its download infrastructure without account credentials or identities. Release notes are sanitized before display. Each installer is verified against the embedded public signing key. See [release operations](docs/RELEASING.md) and [privacy and storage](docs/PRIVACY.md).

## Develop

Requirements: Windows 10/11 x64, Node.js 20.19+ (24 recommended), Rust MSVC, Microsoft C++ Build Tools with the Windows SDK, and WebView2. The Rust toolchain is pinned to 1.96.0; CI uses Node 24.

Run these commands from PowerShell:

    npm ci
    npm run tauri -- dev

Verification uses synthetic accounts and temporary test vaults, without signing in or switching your real accounts:

    npm run build
    npm test
    npm run test:rust
    npm run lint:rust
    npm run format:check
    npm run release:validate
    npm run test:release
    npm run test:installer

The UI tests use Microsoft Edge. Running the real app accesses your local Codex account storage. Compile without packaging with:

    npm run tauri -- build --no-bundle -- --locked

Build a signed installer using the existing external signing key:

    npm run release:build

The ignored release/ folder contains the installer, signature, updater manifest, checksums, release notes, and license notices. Local builds do not publish anything. See [RELEASING.md](docs/RELEASING.md) for first publication and key management.

After committing a new version on `main`, publish it using your GitHub sign-in with `npm run release:publish`. The helper waits for GitHub's checks and installer build before publishing the release. Local signing configuration is read from the ignored `.env`; only the path to the external key file is needed.

## Project structure

| Location | Purpose |
| --- | --- |
| ui/ | Interface, translations, guide, and update dialog |
| src-tauri/src/ | Native storage, Windows integration, synchronization, updater |
| src-tauri/icons/ | Application and installer icons |
| tests/ | Browser interface and update tests with synthetic data |
| scripts/ | Version preparation, signed builds, GitHub secret setup |
| .github/ | CI, releases, dependency updates, issue templates |
| docs/ | Architecture, privacy, release operations |
| CHANGELOG.md | Version history distributed with app updates |

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md). Use [GitHub Issues](https://github.com/nickfouf/ChatGPTAccountSwitcher/issues) for reproducible bugs and [SECURITY.md](SECURITY.md) for vulnerabilities. Never share credentials, vault files, or private keys publicly.

## License

[MIT](LICENSE), copyright 2026 nickfouf. Bundled Nunito and Comfortaa fonts use the SIL Open Font License; their notices are in [FONT-LICENSES.txt](ui/public/FONT-LICENSES.txt). Third-party libraries retain their licenses.
