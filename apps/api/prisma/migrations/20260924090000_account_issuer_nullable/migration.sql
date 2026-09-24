-- Better Auth 1.7.3 went back on the account identity 1.7.0 introduced: an account is keyed on
-- (providerId, accountId) again, as in 1.6, and nothing writes `Account.issuer` any more
-- (better-auth #11153). Left NOT NULL, the column refuses every row Better Auth inserts, so
-- every sign-up, the seed and the demo reset fail with Prisma's "Argument `issuer` is missing"
-- before a statement reaches the database.
--
-- These are the two statements Better Auth's 1.7 upgrade guide gives for Postgres, which it
-- calls enough, and reversible. The column stays: every existing row keeps the
-- `local:credential` that `20260823090000_account_issuer` backfilled or a 0.4.x sign-up wrote,
-- and that is what a rollback to 0.4.1 reads, since its Better Auth still looks the credential
-- account up by issuer. Rows written from here on carry NULL. Dropping the column is a later,
-- separate step.
--
-- The unique index goes with the constraint. On NULLs, which Postgres treats as distinct, it
-- would enforce nothing, and nothing looks an account up by (issuer, accountId): sign-in reads
-- the user's accounts through the `userId` relation, which `Account_userId_idx` serves.
DROP INDEX "Account_issuer_accountId_key";

ALTER TABLE "Account" ALTER COLUMN "issuer" DROP NOT NULL;
