# Security Policy

How to report a vulnerability in Kurul.

## Supported versions

Kurul is pre-1.0: only the latest `0.y` release receives security fixes. There is no
support matrix beyond that — upgrade to the latest release to stay covered. A fix for an
already-released version ships as a `hotfix/*` branch merged into `main` and back-merged into
`develop`; a fix for something not yet released goes to `develop` as an ordinary `fix/*`
branch and rides the next release. Neither is a direct commit: `main` and `develop` are
protected and every change arrives through a pull request, security fixes included. See
[docs/git-strategy.md](docs/git-strategy.md).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately using one of:

1. **[GitHub Security Advisories](https://github.com/dravcore/kurul/security/advisories/new)**
   (preferred) — private by default, keeps discussion and any fix in one place.
2. **Email**: developer@dogancanyildiz.com

Include what you can: affected component, reproduction steps, impact, and any suggested
fix.

## Response expectations

Kurul is currently maintained by a single maintainer. There is no guaranteed SLA yet —
expect an initial acknowledgment within a few days, and be patient on timelines for a fix.
Severity and reachability of the issue will determine how it's prioritized.

## Disclosure

Please give the maintainer a reasonable window to investigate and ship a fix before any
public disclosure. Coordinated disclosure will be worked out together once a report is
acknowledged.
