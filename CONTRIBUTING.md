# Contributing to notti-web-sdk

## Prerequisites

- Node.js: the version in `.nvmrc`
- pnpm (version in `package.json`, `packageManager`)

## Development setup

```bash
git clone https://github.com/zeeplabs/zeep-notti-web
cd zeep-notti-web
pnpm install
```

`pnpm install` also installs the git hooks (lefthook): ESLint and `tsc` on commit, commitlint on the message. Do not bypass them with `--no-verify`.

## Running checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass; this is what CI runs (`.github/workflows/ci.yml`). Tests use mocked browser globals, and the worker is tested with a fake `ServiceWorkerGlobalScope`, so no browser is needed. To try the SDK in a real browser against a Notti server, run `pnpm example` (see the README).

## Making changes

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-change`
3. Make your changes, with tests that fail without them
4. Run the four checks above
5. Commit with a Conventional Commit message (see below)
6. Open a pull request against `main`

## Things to keep in mind

- The public API in `src/index.ts` and the service worker file are a contract for third-party sites. A breaking change needs a clear note in the PR and in `CHANGELOG.md`.
- Never log tokens, push endpoints, keys or any end-user data, and never commit credentials. Samples use placeholders.
- `SDK_VERSION` in `src/version.ts` must match `package.json` (a test checks it).
- Browser support claims need evidence. Say which browser and OS you tested; do not state behavior you did not observe.

## Commit style

Conventional Commits, enforced by commitlint:

```
type(scope): short description

Longer explanation if needed.
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

## Releases

Maintainers only. A release is a version bump, a `CHANGELOG.md` entry and a `v*` tag; `.github/workflows/release.yml` publishes to npm.

## What to work on

Check open issues labeled `good first issue` or `help wanted`.

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree your code will be licensed under the [MIT License](LICENSE).
