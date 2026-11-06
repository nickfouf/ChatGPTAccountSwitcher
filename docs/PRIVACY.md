# Privacy and storage

The app saves Codex credentials locally to support switching. Profiles, previous versions, exclusions, and recovery information are encrypted locally. Windows retains DPAPI for the current Windows user at `%LOCALAPPDATA%\CodexHarbor`. macOS uses `~/Library/Application Support/CodexHarbor`; Linux uses `$XDG_DATA_HOME/CodexHarbor` or `~/.local/share/CodexHarbor`. On macOS/Linux, AES-256-GCM protects vault files with a random key stored in macOS Keychain or Linux Secret Service, under service `local.codexharbor.desktop`, account `vault-key-v1`. Directories use mode 0700 and atomically written files use 0600. There is no plaintext-key fallback. An unavailable credential store blocks saving/decryption. Copying vault files alone to another OS, user, or machine is not a supported backup/restore method.

Switching replaces the live Codex authentication file and restarts Codex after confirmation. Removing a saved account deletes this app's profile and previous encrypted files; it does not sign out the live Codex session or delete chats.

Browser sign-in and renewal use the official locally installed Codex app-server. Temporary authentication directories have restricted access and are cleaned up when sign-in completes, is cancelled, or on startup after interruption.

The interface receives account display information and usage summaries, never access tokens or refresh tokens. Account usage requests contact OpenAI services with saved credentials. This project configures no analytics or crash reporting service.

App update checks contact GitHub Releases and its download infrastructure. These requests include standard connection metadata such as an IP address and updater user agent. They do not include credentials, account email addresses, or vault contents. Automatic app update checks can be disabled in Settings; manual checks remain available.

The installer and uninstaller preserve the encrypted vault. Uninstalling does not sign out Codex. To remove switcher data permanently, close the app and deliberately delete the platform's `CodexHarbor` data directory through your file manager when its saved profiles and recovery data are no longer needed.

On macOS/Linux, removing all switcher data also requires removing its `vault-key-v1` entry from the system credential store. Keep that key while retaining any encrypted vault or recovery files. The switcher never changes Codex's credential-storage configuration; it requires file storage and refuses explicitly configured keyring, auto, or ephemeral storage.

Never attach vault files, auth.json, tokens, private signing keys, or unredacted account screenshots to public issues.
