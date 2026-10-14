# Thread Weaver

Wannabe Press's reading app: story games, novels, comics and The Weave lore codex.
Web: https://thread.wannabepress.com (Netlify site `quest-rpg-store`). Native: Cordova via VoltBuilder
(`com.russellnohelty.threadweaver`).

## Backend

Since 1.16.0 (13 Oct 2026) Thread Weaver has its **own Supabase project**: `nzkgurdmvgkizvzisqxt`.
Thread Weaver accounts are separate from Hapitalist's. Paying Hapitalist members still get Unlock
Everything: the `hapi-member-sync` function pulls hashed emails of paying members from Hapitalist hourly.

Edge functions (Thread Weaver project): `library-url`, `checkout`, `book-checkout-webhook`,
`apple-iap-verify`, `apple-iap-notifications`, `google-play-verify`, `serial`, `delete-account`,
`tw-auth` (sign-up / reset / sign-in-link emails, sent through Amazon SES from wannabepress.com),
`hapi-member-sync`.

## Layout

This repo mirrors what is deployed to Netlify, path for path:

- `www/` – the app (the web site and the native bundle's web root)
- `config.xml`, `res/`, `resources/` – Cordova / VoltBuilder packaging
- `_headers`, `_redirects` – Netlify routing

Signing certificates and provisioning profiles are **not** in this repo. It is public.

## Versioning

Stamp every build in `www/comstation.js` (`TW_VERSION`), `www/app.html` (`TW_APP_VERSION`),
`www/sw.js` (`SHELL_CACHE`) and `config.xml` (`version`, `ios-CFBundleVersion`, `android-versionCode`).
