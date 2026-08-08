# 0008. Git Flow + Conventional Commits + SemVer

**Status:** Accepted
**Date:** 2026-08-08

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0008-git-flow-semver.md)

## Context

Kurultay ships versioned releases of a self-hosted product, rather than
continuously deploying a single hosted SaaS instance. The branching model,
commit convention, and versioning scheme need to fit that release shape.

## Decision

**Git Flow** (`main` / `develop` / `feature/*` / `fix/*` / `docs/*` / `chore/*` /
`release/*` / `hotfix/*`) +
**Conventional Commits** + **SemVer** + a maintained `CHANGELOG.md` in **Keep a
Changelog** format.

## Rationale

- Chosen over GitHub Flow because the project ships versioned releases of a
  self-hosted product: it needs a stable release line and a hotfix path that
  can move independently of in-progress `develop` work. GitHub Flow's
  single-main-branch model fits continuously-deployed SaaS better than it fits
  this shape.
- Conventional Commits produces a structured commit history that can drive
  changelog and release automation later.
- SemVer communicates compatibility expectations to self-hosters upgrading
  between versions.
- Keep a Changelog keeps `CHANGELOG.md` human-readable and consistently
  structured (Added / Changed / Fixed / etc.).
- **Deliberate deviation from peers:** several large OSS projects skip
  `CHANGELOG.md` in favor of GitHub Releases alone. Kurultay keeps both in
  sync deliberately — a changelog file in the repo is more accessible to
  self-hosters scanning history without leaving their clone.
- Matches the maintainer's existing house style: `main`/`develop` plus typed
  branch prefixes (`feature/`, `fix/`, `docs/`, `chore/`, `release/`, `hotfix/`)
  are already the pattern used across the maintainer's own repositories,
  minimizing process-switching cost.

## Consequences

- Clear separation between "in development" (`develop`) and "released and
  stable" (`main`).
- A hotfix path exists that doesn't disrupt in-progress feature work.
- CHANGELOG.md and SemVer together give self-hosters clear upgrade guidance.
- More branch and process overhead than GitHub Flow for a small/solo team.
- Keeping `CHANGELOG.md` and GitHub Releases in sync is a manual discipline
  that can drift without enforcement (e.g., a PR checklist item).
- Git Flow's release-branch ceremony can feel heavy pre-1.0, when releases may
  be frequent and informal.

## Alternatives considered

| Alternative | Why not |
|---|---|
| GitHub Flow | Fits continuously-deployed SaaS; doesn't fit a versioned self-hosted product needing stable release lines and hotfixes |
| Trunk-based development | Same mismatch — no natural home for release stabilization or hotfixes against older versions |
| GitHub Releases only (no CHANGELOG.md) | Common peer pattern, but less accessible to self-hosters browsing the repo directly; rejected per the deliberate-deviation rationale above |
