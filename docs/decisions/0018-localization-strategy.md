# 0018. Localization Strategy: next-intl Without URL Routing

**Status:** Accepted
**Date:** 2026-08-12

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0018-localization-strategy.md)

## Context

The product plan is to finish the English interface completely, then add Turkish as a second
language. That raised the question of whether next-intl is the right vehicle for Turkish or
whether a different approach is needed.

The answer to the narrow question is that next-intl is already the vehicle, and has been for
some time. `NextIntlClientProvider` wraps the root layout, `getLocale()` / `getMessages()`
feed it, 53 files call `useTranslations` or `getTranslations`, and `apps/web/messages/en.json`
holds roughly 279 keys. `formatRelativeTime` already takes a locale parameter rather than
pinning `'en'`. The only thing keeping the app monolingual is one line in
`apps/web/i18n/request.ts`:

```ts
const locale = 'en';
```

So the real decision is not "which library" but the three questions that line defers: how a
locale gets chosen, where the preference lives, and what happens to strings that are stored
in the database rather than in a message catalog.

Two constraints shape the answer. First, every page in Kurultay is behind authentication —
there is no indexable content, and a marketing or documentation site, if one is built, will
live outside this Next.js application. Second, `apps/api` has no locale awareness at all:
errors are returned as stable codes plus an HTTP status, and the web maps them to translation
keys through `resolveApiMessage`.

This ADR is about product localization. The English-canonical / `docs/tr` mirror rule for
repository documentation is a separate, unrelated convention.

## Decision

next-intl stays; no second i18n library is introduced. Locale is resolved **without URL
routing**, from a chain implemented in `apps/web/i18n/request.ts`:

```
User.locale  →  locale cookie  →  Accept-Language  →  'en'
```

There is no `[locale]` path segment and no i18n middleware. Alongside that:

1. **Locale is a user-level preference**, stored as a nullable IETF tag on `User` and mirrored
   into a cookie when the user picks a language. It is not a workspace setting.
2. **The backend stays free of UI translation.** The API keeps returning error codes and
   statuses; the web owns the message catalog. The API reads `Accept-Language` only for
   content it writes into the database on the user's behalf, and for outbound email.
3. **Stored strings follow the renameability rule:** if a user can rename it, it is user data —
   seed it in the creator's locale and store it as a plain string. If a user cannot rename it
   (`priority`, roles, enum labels), it is system data — store the enum and translate on the
   web.
4. **English remains canonical.** `messages/en.json` is the source of truth; `tr.json` is added
   only once the English interface is complete.

## Rationale

- The one real payoff of a `[locale]` path segment is SEO: distinct URLs per language plus
  `hreflang`. Nothing in Kurultay is indexed, so that payoff does not apply, and the marketing
  site that would need it is planned to live elsewhere.
- The costs of the path segment are paid immediately and in full: the entire `app/` tree moves
  under `app/[locale]/`, a middleware lands next to Better Auth's session flow, and every
  `<Link>` and `router.push` has to switch to next-intl's locale-aware wrappers. Any call site
  that misses the switch silently resets the user's language — a quiet failure mode with no
  test that naturally catches it.
- next-intl documents the no-routing setup as a first-class configuration, so this choice does
  not fight the library or fall off the supported path.
- User-level rather than workspace-level, because one workspace legitimately contains members
  who read different languages. A workspace-wide setting would force one of them into the
  wrong interface.
- Keeping translation out of the backend avoids maintaining the same catalog twice. The API
  already speaks in codes; giving it prose in two languages would make the web's catalog and
  the API's catalog drift.

## Consequences

- `User` gains a nullable `locale` column and a migration; a settings screen has to expose it.
  Because outbound email needs the recipient's language, the preference must live in the
  database and not only in a cookie.
- `apps/web/i18n/request.ts` grows the resolution chain and a cookie write on language change.
- Unauthenticated routes — notably `/invite/[invitationId]` — resolve from `Accept-Language`,
  so an invitee sees their own language without being signed in. This is the desired behavior
  and the main reason the invite flow does not force the path-segment approach.
- A shared board URL carries no language: the recipient sees it in _their_ language, not the
  sender's. Accepted deliberately; it is usually what people want.
- Reviewing two languages side by side requires separate browser profiles or a private window.
- **Deferred, not dismissed:** if a marketing or documentation site is ever moved _into_ this
  application, `[locale]` routing has to be introduced at that point, and the migration is the
  full cost described above. That trigger is recorded here so the deferral stays a decision
  rather than an oversight.
- From now on every new user-visible string goes through `messages/en.json`. A hardcoded string
  is a defect, not a shortcut, because it is invisible to the Turkish pass and will not show up
  as a missing key.
- The API gains a small amount of locale awareness — reading `Accept-Language` — which it did
  not have before. It is confined to database seeding and email.

## Alternatives considered

| Alternative                                           | Why not                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[locale]` path segment (next-intl's routed default)  | Its SEO payoff does not apply to an app with no indexable pages; it costs the whole route tree, a middleware, and permanent link discipline starting today |
| Workspace-level locale                                | One workspace legitimately has members who read different languages; a shared setting forces someone into the wrong language                               |
| Backend i18n (`nestjs-i18n`, `Accept-Language` prose) | Duplicates the catalog the web already owns and lets the two drift; the API already returns codes, which the web maps through `resolveApiMessage`          |
| Switch to react-i18next or Lingui                     | next-intl is already integrated across 53 files and is the App-Router-native choice; a swap buys nothing and re-does working code                          |
| Machine translation at request time                   | Unpredictable product vocabulary, per-request latency and cost, and no way to review the wording before users see it                                       |
