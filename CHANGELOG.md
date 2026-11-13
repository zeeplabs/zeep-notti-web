# Changelog

## 0.2.0 (2026-11-13)

- In-App messages on the web. A browser with a Web Push subscription fetches the messages targeted at Web once per page load and shows the first one that starts with the session, as a Shadow DOM overlay with the four layouts (`center`, `top`, `bottom`, `full`), the style tokens, a close control and the auto-dismiss timer. It reports `impression`, `click` and `dismiss` like the mobile SDKs. A visitor with no registered browser makes no request and sees nothing; `init` never waits for it and its result does not change.
- `Notti.InAppMessages.addClickListener(handler)` (returns `{ remove() }`) receives `{ messageId, buttonId, action }` after a button or the image was pressed. The SDK opens nothing itself.
- `Notti.trackEvent(name)` shows the oldest held message triggered by that event name, when no message is visible. Names tracked before `init` finishes are remembered (up to 32).
- `init({ inApp: false })` keeps In-App off for that page: no request, no overlay. Any other value, or leaving it out, keeps it on. Web Push is not affected.
- A page shows at most one blocking message (`center` or `full`) and one bar (`top` or `bottom`) per page load, one at a time, like the mobile SDKs' one modal per session. A message that arrives while another is open, or whose slot was already used, is dropped, not queued. A message that failed to appear does not use its slot.
- A message whose image cannot load is not shown and reports nothing. `push_permission` buttons are not shown on the web.
- A link reaches the click listener only if the SDK has checked it: a `url` action must be https, and a `deeplink` must not be `javascript:`, `data:`, `vbscript:` or `file:`. A button or image action that fails is dropped.
- A text or background colour set alone no longer meets a default that cannot be read against it: the missing half is derived from the one the author set, by contrast (the same for the button and its text). When the author colours the panel but not the button, the button gets the stock colour that stands out from the panel (contrast of at least 3, so a dark button never melts into a dark panel), and its label stays readable.
- `click` and `dismiss` are sent at once, not behind the `impression`, so a listener that navigates away cannot lose the click. If a browser refuses `keepalive` on the events request (it needs a CORS preflight), the event is repeated once without it. A 401 or 403 from the events route ends In-App for the page load. A 403 from `eligible` is remembered for a day per browser (no request and no console warning on the next loads).
- `full` covers the margin around its panel with a transparent shield, so the page behind it is not clickable. `top` and `bottom` announce their text politely and their auto-dismiss waits while the pointer is over the bar or focus is inside it. If a strict `style-src` blocks the `<style>` fallback (Safari 16.1 to 16.3, which has no constructable stylesheets), the message is not shown and no impression is sent.
- The Notti server must be v0.31.0 or later, the first version that sends CORS headers on the In-App routes. Update the server first, then the SDK.

### Upgrading to 0.2.0

- **It switches In-App on by itself.** For a site whose visitors have a registered browser, updating to 0.2.0 starts the fetch at every page load, and a message shows as soon as an author targets Web. To keep it off on a page that must never show an overlay (a checkout, an embedded iframe), pass `inApp: false` to `init`: nothing is fetched and nothing is shown. A pause or resume at runtime is a candidate follow-up.
- **A visitor who accepts push during a visit gets In-App messages from the next page load**, not in the same one: the session decides once, at `init`, whether a registered browser exists.
- **Server first, then reload the dashboard.** Update the Notti server, then reload every open dashboard tab before the SDK is released: an editor opened before the server update can save `platforms: []` (every platform, Web included) over a message that the server migration had pinned to iOS and Android.

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
