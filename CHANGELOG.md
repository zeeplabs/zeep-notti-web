# Changelog

## 0.1.2 (2026-11-12)

- A returning visitor now stays an active browser in Notti. A registered browser makes no request that tells Notti it is still active, so after the registration Notti never heard from it again and, after 30 days, dropped it from the monthly active users (and ranked it last when an App is over its plan limit) even if the visitor kept coming. At `init`, a browser that Notti has not heard from for a day sends one small request in the background (its permission status), about once a day: tabs open at the same time send it once between them, and an answer that a retry cannot change (a deleted device gets a 403) is not repeated until the next day. It never delays or fails `init`, and a failure that could succeed later (network, 5xx, 408, 429) is tried again at the next `init`.

## 0.1.1 (2026-11-12)

Fixes found in a review of 0.1.0. **0.1.0 has the first two defects below, so update.**

- A registration that failed is repeated at the next `init`. In 0.1.0 a failed registration request, or a failed follow-up request, was never repeated: the browser stayed unregistered, the worker reported no `received`, `clicked` or `opened`, and `identify`, `setTags` and `logout` stayed pending. The Device is now stored as soon as the server has it, and the `sdk_name` and `sdk_version` update is repeated until it is acknowledged.
- A `logout`, `identify` or `setTags` made while the registration request was in flight is no longer lost. In 0.1.0 a `logout` at that moment could leave the browser receiving the previous user's pushes. Profile updates are also sent one at a time, so two quick calls cannot reach the server out of order.
- The service worker handles clicks only on notifications it showed. A site that loads `notti-sw.js` into its own service worker no longer has its own notifications closed, opened or reported by Notti.
- `sideEffects` no longer lets a bundler drop `import 'notti-web-sdk/sw'` from a custom service worker.
- The IndexedDB connection closes when another context upgrades the database, so a later SDK version is not blocked behind an open tab or worker. One connection is shared instead of one per call.
- README: the click target text matches the code (`http(s)` URLs), and there is a note for sites with their own service worker.
- Releases: the workflow publishes a tag only when its commit is on `main`.

## 0.1.0 (2026-11-12)

First public release.

- `Notti.init`, `requestPermission`, `identify`, `setTags`, `removeTags`, `logout`, `getSubscription`.
- Standalone service worker (`notti-web-sdk/sw`, `dist/notti-sw.js`): always shows a notification, reports `received`, `clicked` and `opened`, re-registers on `pushsubscriptionchange`.
- ESM, CJS and type declarations.
- A single subscribe-and-register runs at a time, so `init` and `requestPermission` racing no longer create two devices.

Not validated yet: Safari (macOS and iOS), Chrome Android, Firefox, Edge, and a real click on a notification.
