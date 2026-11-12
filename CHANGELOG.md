# Changelog

## 0.1.0 (2026-11-12)

First public release.

- `Notti.init`, `requestPermission`, `identify`, `setTags`, `removeTags`, `logout`, `getSubscription`.
- Standalone service worker (`notti-web-sdk/sw`, `dist/notti-sw.js`): always shows a notification, reports `received`, `clicked` and `opened`, re-registers on `pushsubscriptionchange`.
- ESM, CJS and type declarations.
- A single subscribe-and-register runs at a time, so `init` and `requestPermission` racing no longer create two devices.

Not validated yet: Safari (macOS and iOS), Chrome Android, Firefox, Edge, and a real click on a notification.
