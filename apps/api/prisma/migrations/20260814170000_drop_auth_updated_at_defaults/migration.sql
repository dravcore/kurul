-- Resolve the drift between `schema.prisma` and the checked-in migrations on the four tables
-- Better Auth writes: `User`, `Session`, `Account` and `Verification`.
--
-- The schema has always described these columns as `@updatedAt` with no default, and Prisma
-- emits `@updatedAt` as a plain `NOT NULL` column — `Task` in the initial migration is the
-- proof, same construct, same repository, no default. The four defaults below entered by hand
-- with the Better Auth tables and were never described anywhere in the schema, so every
-- `prisma migrate dev` since has re-proposed dropping them. The database is the side that
-- drifted; this migration moves it back to what the schema says.
--
-- Measured before writing this, against these migrations applied to a real database:
--   * Prisma includes `updatedAt` in its INSERT even while the default exists, so the default
--     never fires on the only write path there is.
--   * Better Auth reaches these tables through `prismaAdapter`, i.e. the same client and the
--     same `@updatedAt` handling; no code anywhere writes them with raw SQL.
--   * With the defaults dropped, `create` on all four models still succeeds.
--
-- What is genuinely given up: a raw `INSERT` that omits `updatedAt` fails after this, where
-- before the default would have filled it. That safety net only ever covered a writer this
-- codebase does not have, and keeping it costs permanent drift — which is worse, because a
-- migration diff that is never empty is a diff nobody reads.

ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Session" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Verification" ALTER COLUMN "updatedAt" DROP DEFAULT;
