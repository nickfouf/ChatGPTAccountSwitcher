# Security policy

The latest stable release receives security fixes.

Report vulnerabilities through the repository's **Security → Report a vulnerability** private reporting feature when enabled. Maintainers should enable private reporting before launch. If unavailable, open an issue asking for a private reporting channel, without exploit details or secrets.

Never post tokens, auth.json, encrypted vault files, private signing keys, personal account details, or working credential exploits publicly.

Windows DPAPI protects stored credentials for the current Windows user. It cannot protect against malware running as that same user. The frontend does not receive tokens.

App updates require HTTPS and a valid publisher signature. The private signing key stays outside the repository and in GitHub Actions secrets. Update signing does not establish Authenticode identity or SmartScreen reputation.

Save work before confirming a switch: Codex will restart. Changes to Codex authentication or app-server interfaces may require compatibility updates.
