# Contributing

Open an issue before a large change. Keep pull requests focused, explain the resulting behavior, and include relevant verification. Use synthetic identities in screenshots and tests.

Requirements: Node.js 20.19+ (24 recommended), the pinned Rust toolchain, and your OS's Tauri prerequisites. See [desktop platform setup](docs/PLATFORMS.md#development) for Windows, macOS, and Linux requirements. Install dependencies with `npm ci`; develop with `npm run tauri -- dev`. Non-Windows UI tests need Chromium (`npx playwright install --with-deps chromium`).

```powershell
npm run build
npm test
npm run test:rust
npm run lint:rust
npm run format:check
npm run release:validate
npm run test:release
npm run test:installer
```

Add user-visible changes to `CHANGELOG.md`. Maintainers prepare version bumps; ordinary fixes should not independently change package versions.

- Keep credentials in Rust, never in UI snapshots or logs.
- Preserve existing storage identity and recovery behavior.
- Preserve identity checks and confirmation before restarting Codex.
- Sanitize remote release notes and retain signature and TLS verification.
- Keep private keys, auth files, personal screenshots, and generated binaries out of Git.
- Add meaningful tests for behavior changes. Storage tests must use temporary vaults.

Forks need their own signing identity and release endpoint before distributing installers. See [RELEASING.md](docs/RELEASING.md). Contributions use the MIT license. Be respectful and provide clear reproduction steps.
