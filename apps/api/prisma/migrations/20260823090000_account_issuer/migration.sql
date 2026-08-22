-- Better Auth 1.7 keys account identity on (issuer, accountId) instead of accountId alone
-- (better-auth #10403). `Account.issuer` is a required column as of that release.
--
-- The backfill is not optional housekeeping: `/sign-in/email` now looks the credential account
-- up with `providerId = 'credential' AND issuer = 'local:credential' AND accountId = user.id`.
-- An existing row left without an issuer matches nothing, and every account that predates this
-- migration would be unable to sign in. So the column is added nullable, filled, and only then
-- made NOT NULL: three statements rather than one `ADD COLUMN ... NOT NULL DEFAULT`, because a
-- default would silently paper over a provider this backfill does not know about.
--
-- `local:` + the URL-encoded provider id is Better Auth's own synthetic issuer for providers
-- that have none of their own (`createLocalAccountIssuer`). Kurul configures no social
-- providers, so in practice every row here is `credential` and becomes `local:credential`;
-- the expression is written generally anyway so a row from any other local provider is
-- given the issuer that provider's code would have written.
ALTER TABLE "Account" ADD COLUMN "issuer" TEXT;

UPDATE "Account" SET "issuer" = 'local:' || "providerId" WHERE "issuer" IS NULL;

ALTER TABLE "Account" ALTER COLUMN "issuer" SET NOT NULL;

-- The uniqueness that makes the pair an identity. Safe to add against existing data: the only
-- rows that exist are credential accounts, whose `accountId` is the owning user's id, so the
-- pair is already distinct per row.
CREATE UNIQUE INDEX "Account_issuer_accountId_key" ON "Account"("issuer", "accountId");
