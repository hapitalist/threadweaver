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
`hapi-member-sync`, `google-play-voided` (hourly: takes back Google Play refunds; log in `play_voided`).
`admin-readers` (admin only: reader heat across Substack, BackerKit fiction backers and app accounts).
Admin page `/admin.html` is web only. Since 1.16.5 it also shows Kit history from `public.kit_readers`
(imported by Russell from the Cohortz table `tw_reader_kit_export`; summary via `admin_kit_summary()`).

Refunds: Stripe refunds/disputes arrive at `book-checkout-webhook`. Apple notifies ONE address (the
Hapitalist project's `apple-iap-notifications`); it and this project's listener pass every verified
Thread Weaver notice to each other, so purchases in either database are revoked. Stripe Checkout is
branded "Wannabe Press · Thread Weaver" per session (the Stripe account is shared with Hapitalist).

## Layout

This repo mirrors what is deployed to Netlify, path for path:

- `www/` – the app (the web site and the native bundle's web root)
- `config.xml`, `res/`, `resources/` – Cordova / VoltBuilder packaging
- `_headers`, `_redirects` – Netlify routing

Signing certificates and provisioning profiles are **not** in this repo. It is public.

## Versioning

Stamp every build in `www/comstation.js` (`TW_VERSION`), `www/app.html` (`TW_APP_VERSION`),
`www/sw.js` (`SHELL_CACHE`) and `config.xml` (`version`, `ios-CFBundleVersion`, `android-versionCode`).
