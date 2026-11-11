# Notti Web SDK

Official Web SDK for [Notti](https://github.com/zeeplabs/zeep-notti) push notifications. Sends to
browsers through the Web Push protocol (RFC 8030) with VAPID (RFC 8292) and `aes128gcm` payload
encryption (RFC 8291).

> **Status: in development. Not published.**
>
> **npm package name: TBD.** The name is not confirmed yet, so `package.json` is `private` and nothing
> can be published by accident. Do not install this from npm until this line changes.

## Usage

1. **Serve the worker from your own origin, at the root.** Copy `dist/notti-sw.js` to your site as
   `/notti-sw.js` (it must be the file shipped with the same SDK version; the SDK warns when they differ).
   Its scope must cover the pages that subscribe.
2. **Initialize** when the page loads. It never prompts and never throws:

   ```js
   import { Notti } from '<package name: TBD>';

   const { supported, reason } = await Notti.init({
     appId: 'YOUR_APP_ID',
     clientKey: 'YOUR_CLIENT_KEY', // the Client key, never a REST key
     host: 'https://notti.example.com', // optional; defaults to https://app.zeepnotti.app
   });
   ```

   `reason` is one of `insecure_context`, `ios_requires_home_screen`, `no_service_worker`,
   `no_push_manager`, `not_enabled` (web push is off for the App), `request_failed`, `invalid_options`.

3. **Ask for permission from a user gesture** (a click), never on page load:

   ```js
   button.addEventListener('click', async () => {
     const result = await Notti.requestPermission();
     // { permission: 'granted' | 'denied' | 'default', registered: boolean, deviceId?, reason? }
   });
   ```

   A denied or dismissed prompt registers nothing and the SDK never asks again on its own.

4. **Identify and tag** (same semantics as the mobile SDKs):

   ```js
   await Notti.identify('user-42');
   await Notti.setTags({ plan: 'pro', beta: null }); // null removes a key
   await Notti.removeTags(['beta']);
   await Notti.logout(); // external_user_id: null; tags and subscription are kept
   ```

Calls made before the browser is registered are kept and sent at registration; a call that fails is
retried at the next `init`.

### Behaviour worth knowing

- The service worker always shows a notification, even for a payload it cannot read, because a browser
  may revoke permission from a site that receives a push and shows nothing.
- It reports `received`, `clicked` and `opened` to Notti. Dismissing a notification reports nothing.
- The click target is `data.url` (a path on your origin or an `https` URL). An absent or non-http(s) URL
  opens the site root. A URL on another origin is opened but never focuses an existing window.
- When the browser replaces the subscription (or the App's VAPID key was rotated) the SDK registers the
  new one on the next `init`, and the worker does it on `pushsubscriptionchange`.
- The Notti server must answer cross-origin requests from your site: web push config, device register,
  device update and notification events send CORS headers on a Notti version that includes web push.

## Try it locally

```sh
pnpm build
pnpm example   # http://localhost:5173
```

The sample asks for the Notti host, App ID and Client key, then walks through init, enable, identify,
tags and logout. It is served over `localhost`, which browsers treat as a secure context.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build      # dist/ (ESM, CJS, types) and dist/notti-sw.js (standalone worker)
pnpm example    # sample page on http://localhost:5173
```

Package manager is pnpm; Node version is in `.nvmrc`.

## License

MIT
