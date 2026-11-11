# Notti Web SDK

Official Web SDK for [Notti](https://github.com/zeeplabs/zeep-notti) push notifications. Sends to
browsers through the Web Push protocol (RFC 8030) with VAPID (RFC 8292) and `aes128gcm` payload
encryption (RFC 8291).

> **Status: in development. Not published.**
>
> **npm package name: TBD.** The name is not confirmed yet, so `package.json` is `private` and nothing
> can be published by accident. Do not install this from npm until this line changes.

## What it will do

- `Notti.init` loads the app's public key and reports whether the browser supports Web Push, without
  prompting and without throwing.
- `Notti.requestPermission()` asks for permission, subscribes and registers the device with the Notti
  API (`platform: "web"`).
- `Notti.identify`, `Notti.setTags` and `Notti.logout` follow the same semantics as the mobile SDKs.
- A service worker (`notti-sw.js`) shows the notification, reports `received`, `clicked` and `opened`,
  and re-subscribes on `pushsubscriptionchange`.

None of this is implemented yet. The scaffold only builds an empty export and an empty worker.

## Requirements

- A secure context (`https`, or `localhost` for development).
- A browser with Service Workers and the Push API. On iOS and iPadOS the site must be added to the
  Home Screen first.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build      # dist/ (ESM, CJS, types) and dist/notti-sw.js (standalone worker)
```

Package manager is pnpm; Node version is in `.nvmrc`.

## License

MIT
