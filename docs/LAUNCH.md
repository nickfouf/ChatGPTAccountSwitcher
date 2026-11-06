# Launch kit

Lead with a concrete result: **switch saved Codex accounts and see usage in one place**. Put the walkthrough before implementation details. The current demo shows the real frontend with synthetic accounts and a simulated native bridge; it is a UI walkthrough, not proof of native switching on every OS.

## Shareable assets

- [Eight-second looping walkthrough](assets/walkthrough.gif): approximately 245 KB, suitable for the README and direct sharing.
- [Account overview](assets/accounts.png): a clean screenshot of the actual interface.
- [Social preview](assets/social-preview.png): 1280 × 640 PNG, under 1 MB, using an actual interface screenshot.
- [Latest release](https://github.com/nickfouf/ChatGPTAccountSwitcher/releases/latest): one stable link for every post.

Regenerate the screenshots with `node scripts/capture-demo.mjs`, then create the GIF with `python scripts/make-demo-gif.py` (Pillow required). Captures use sample accounts and never load native account storage.

For repository link previews, upload `social-preview.png` under GitHub repository **Settings → General → Social preview → Edit**. GitHub documents a preferred image size of 1280 × 640 and a limit under 1 MB. See [GitHub social preview documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

## Short launch post

> I built a small open-source companion for switching saved Codex accounts and checking usage in one place.
>
> Encrypted local storage, 32 languages, and signed updates. Windows, plus experimental Mac/Linux support.
>
> Demo + download: https://github.com/nickfouf/ChatGPTAccountSwitcher

Attach the GIF. Keep the first post focused on the account-switching workflow; explain encryption, installation, and platform caveats in the linked README or a follow-up.

## Community post

**Title:** I made an open-source Codex account switcher with usage cards and encrypted local storage

> I wanted a simpler way to move between my Codex accounts without repeating the sign-in workflow every time, so I built this desktop companion.
>
> It saves accounts locally, shows usage, and confirms before closing and reopening Codex with another saved account. It has 32 interface languages and signed updates. Windows is the existing target; macOS Apple Silicon and Linux x64/ARM64 support is experimental.
>
> The attached walkthrough uses the actual UI with sample accounts; sign-in and native restarts are simulated in the capture. This is an independent community project.
>
> Source and downloads: https://github.com/nickfouf/ChatGPTAccountSwitcher
>
> I'd especially appreciate feedback on installation, account switching, and recovery on Mac/Linux. Which part of switching accounts is most annoying for you today?

For Hacker News, use a factual title such as **Show HN: An open-source desktop switcher for saved Codex accounts**. Adapt the post to each community's rules and interests. Publish manually from the maintainer's account; this task does not post to social networks or message other people.

## First-week distribution

1. Publish the release and verify that every download link works before sharing it.
2. Share the GIF with one short post to an audience that already uses Codex. Use the repository URL consistently.
3. Post a more detailed explanation in one relevant community, including the experimental platform status and a specific request for feedback.
4. Answer installation questions promptly and turn reproducible reports into fixes. Share a second demo when a requested improvement ships.
5. Compare release asset downloads, GitHub traffic, stars, and concrete user reports after 24 hours and seven days. Downloads and successful installation reports are stronger evidence of usefulness than impressions alone.

GitHub topics help people discover related projects; use accurate topics describing the tool and its platforms. See [GitHub topic documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics). Distribution and iteration can improve reach; virality is not predictable.
