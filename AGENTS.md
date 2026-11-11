# AGENTS.md

Operating guide for AI coding agents working in this repo.

## What this repo is

The Notti Web SDK: a TypeScript package plus a standalone service worker (`dist/notti-sw.js`) that
register browsers for Web Push against a Notti server. Consumers are third-party sites, so the public
API in `src/index.ts` and the worker file are a contract.

The server side lives in the sibling repo `../../saas/zeep-notti`, spec in
`.specs/features/web-notifications/` there (requirements WEB-xx, tasks T25 to T31).

## Commands

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass before reporting a task done.

## Conventions

- Conventional Commits, enforced by commitlint through lefthook. Never `--no-verify`.
- Never log tokens, endpoints, keys or any end-user data.
- No credentials in the repo; samples use placeholders.
- Do not publish. The npm package name is undecided (`private: true`).
- Tests verify behavior with mocked browser globals; the worker is tested with a fake
  `ServiceWorkerGlobalScope`.
