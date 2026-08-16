import { PrismaClient } from '../generated/prisma';
import { createSharedPrismaAdapter, registerPoolConsumer } from '../prisma/database';
import type { StoredLocaleReader } from './recipient-locale';

/**
 * The database half of `resolveRecipientLocale`, outside the DI container.
 *
 * A module-level client for the same reason `send-mail.ts` keeps a module-level sender: the
 * only callers are the Better Auth hooks in `auth.ts` and `organization-options.ts`, which the
 * plugin invokes with no injection point of its own. `PrismaService` is unreachable from
 * there.
 *
 * It borrows the shared `pg` pool (`prisma/database.ts`), so it costs no extra Postgres
 * connections, and registers itself as a pool consumer so `closeSharedDatabase` drains it
 * before ending the pool — the same contract `PrismaService` and Better Auth's own client sign.
 *
 * Built lazily, never at module load: the pool insists on `DATABASE_URL`, and this module is
 * imported by the mail unit tests, which have no database.
 */
let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    const created = new PrismaClient({ adapter: createSharedPrismaAdapter() });
    registerPoolConsumer(() => created.$disconnect());
    client = created;
  }
  return client;
}

/**
 * The stored `User.locale` for an address, or `null` when there is no account or no choice.
 *
 * Matched on `email`, which is unique on `User`, rather than on an id: the invitation path
 * knows only the address it is writing to, and half the point of the lookup is finding out
 * whether an account exists behind it at all.
 *
 * The raw column value is returned rather than a narrowed `Locale`; `resolveRecipientLocale`
 * runs every candidate through `matchLocale`, so a tag that has since been dropped from
 * `SUPPORTED_LOCALES` falls through the chain instead of pinning a missing catalog.
 */
export const readStoredLocale: StoredLocaleReader = async (email) => {
  const row = await getClient().user.findUnique({
    where: { email },
    select: { locale: true },
  });
  return row?.locale ?? null;
};
