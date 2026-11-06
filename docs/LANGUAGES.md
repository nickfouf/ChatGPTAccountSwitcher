# Language support

The app offers 32 language options: English, Greek, German, Spanish, French, Italian, Portuguese (Brazil), Portuguese (Portugal), Dutch, Swedish, Danish, Norwegian Bokmål, Finnish, Polish, Czech, Hungarian, Romanian, Bulgarian, Ukrainian, Russian, Turkish, Arabic, Hebrew, Persian, Hindi, Simplified Chinese, Traditional Chinese, Japanese, Korean, Indonesian, Vietnamese, and Thai.

The Windows installer and uninstaller offer the same 32 languages. On first installation, their language selector defaults to the Windows language, with English as the fallback for unsupported languages. An explicit installer choice is remembered for maintenance and uninstall. The app's own language preference remains independent and defaults to Use PC language.

## Automatic selection

New users start with **Use PC language**. The desktop app reads Windows' ordered display-language preferences with `GetUserPreferredUILanguages` using language names. Browser language preferences are used in development or if Windows detection is unavailable. The first supported language is selected; otherwise the app uses English. Language detection runs on startup and when the window regains focus. Browser language changes are also handled.

Regional language tags map to the corresponding translation. Portuguese distinguishes Brazil from Portugal. Chinese honors an explicit script before the region, so `zh-Hant-CN` selects Traditional Chinese and `zh-Hans-TW` selects Simplified Chinese. `no` maps to Norwegian Bokmål.

An explicit choice in Settings overrides automatic selection and persists locally. Existing English and Greek preferences remain valid. Choosing **Use PC language** saves `system`, so later Windows language changes are followed. An invalid saved preference returns to automatic selection.

## Translations

Account-interface messages are in `ui/locales/<locale>.json`. Each file contains the same keys as `en.json`, covering account actions, dialogs, connection feedback, accessibility labels, and the guided tour. Preserve placeholders such as `{name}`, `{n}`, and `{total}` exactly; their order may change to suit the language. Keep product names unchanged. `ui/languages.js` defines native display names and writing directions. Unknown message keys fall back to English.

Update-interface messages are in `ui/updates-copy.js` (English and Greek) and `ui/localized-updates.js` (the other languages). Each language has the same update keys. Release notes themselves remain in the language supplied by the publisher.

Dates use `Intl.DateTimeFormat` with the active language. Arabic, Hebrew, and Persian use an RTL layout; email addresses retain LTR direction. Nunito includes Latin, extended Latin, and Cyrillic glyphs, Comfortaa supplies Greek glyphs, and Windows system fonts cover the other writing systems. All translations and bundled fonts work offline.

Run `npm test` to check catalogue completeness, placeholders, detection and persistence, and all 32 interfaces, settings panels, confirmation dialogs, and guide steps at narrow window sizes. Translation wording should also receive native-speaker review as contributions arrive.

Installer locale names are mapped in `src-tauri/installer/languages.json`. The standard wizard pages come from NSIS, and all 27 Tauri-specific messages per language are in `src-tauri/installer/languages/*.nsh`. These include maintenance, running-app, WebView2 download/install, and uninstall messages. `npm run test:installer` checks exact parity with the app, complete messages, variables, and attribution. Every signed release build runs these checks before compiling all language packs. The MIT license agreement remains the original English legal text.
