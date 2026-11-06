# Installer translations

The standard installer pages and language selector use the translations bundled
with NSIS. `languages.json` maps each app locale to its NSIS language name.
English is first so unsupported Windows languages have a predictable fallback.
NSIS selects the Windows language initially and remembers an explicit installer
language choice for maintenance and uninstall. App preferences remain independent.

The custom message files for Arabic, Bulgarian, Dutch, English, Farsi, French,
German, Hebrew, Italian, Japanese, Korean, Norwegian, Portuguese, PortugueseBR,
Russian, SimpChinese, Spanish, Swedish, TradChinese, Turkish, Ukrainian, and
Vietnamese were adapted from Tauri CLI v2.12.4:

https://github.com/tauri-apps/tauri/tree/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/languages

Copyright 2019–2024 Tauri Programme within The Commons Conservancy.
These files are available under MIT OR Apache-2.0. This project uses their MIT
license, reproduced in `UPSTREAM-LICENSE-MIT.txt` and bundled third-party notices.
Product-name placeholders, language identifiers, and message keys are normalized
to the installed NSIS/Tauri versions. Other installer translations are contributed
under this project's MIT license.

Keep all 27 custom message keys and their NSIS variables in every language.
Use `${PRODUCTNAME}` rather than Tauri template syntax inside these include files.
Run `npm run test:installer` to check locale parity, message coverage, and variables.
The release build compiles all 32 standard language packs and custom message files.
