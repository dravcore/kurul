# Security Policy

How to report a vulnerability in Kurultay.

## Supported versions

Kurultay is pre-release — there is no stable version yet and no version support matrix.
All security fixes land on `main`/latest until a first stable release exists; this file
will gain a supported-versions table at that point. After the first release, fixes follow
`hotfix/*` per [docs/git-strategy.md](docs/git-strategy.md).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately using one of:

1. **[GitHub Security Advisories](https://github.com/dravcore/kurultay/security/advisories/new)**
   (preferred) — private by default, keeps discussion and any fix in one place.
2. **Email**: developer@dogancanyildiz.com

Include what you can: affected component, reproduction steps, impact, and any suggested
fix.

## Response expectations

Kurultay is currently maintained by a single maintainer. There is no guaranteed SLA yet —
expect an initial acknowledgment within a few days, and be patient on timelines for a fix.
Severity and reachability of the issue will determine how it's prioritized.

## Disclosure

Please give the maintainer a reasonable window to investigate and ship a fix before any
public disclosure. Coordinated disclosure will be worked out together once a report is
acknowledged.
