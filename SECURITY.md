# Security Policy

## Supported Versions

| Version  | Supported |
| -------- | --------- |
| latest   | ✅        |
| < latest | ❌        |

The SDK is `0.x`: fixes land in a new release of the latest version, not as backports.

## Reporting a Vulnerability

Please **do not** open public issues for security vulnerabilities.

Send a private report to **security@zeeptecnologia.com.br** or reach out to the maintainers directly.

You can expect:

- Acknowledgment within 48 hours
- Regular updates on the fix progress
- Credit upon disclosure (if desired)

## Responsible Disclosure

We kindly ask that you:

1. Give us reasonable time to fix the issue before public disclosure
2. Provide sufficient details to reproduce and understand the vulnerability
3. Avoid accessing or modifying data beyond what's necessary to demonstrate the issue

Do not include real Client keys, push endpoints or end-user data in a report. Use placeholders.

## Scope

In scope:

- The `notti-web-sdk` package: `Notti.*` calls, the standalone service worker (`notti-sw.js`) and what they store in the browser (IndexedDB)
- Handling of the Client key, the push subscription and notification click URLs (for example open-redirect or cross-origin focus issues)
- The published npm package contents and the release workflow

Out of scope:

- Vulnerabilities in the Notti server itself. Report those to the same address and name the Notti server
- Dependencies with known CVEs (reported upstream)
- Browser or push-service behavior (FCM, Mozilla autopush, Apple) that this SDK does not control
