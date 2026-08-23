-- Personal access tokens: a Bearer credential bound to one user in one workspace.
-- Only the SHA-256 of the plaintext is stored (`tokenHash`, unique, the auth lookup key);
-- `prefix` is the displayable head of the secret. Revocation is a timestamp, not a delete.
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalAccessToken_tokenHash_key" ON "PersonalAccessToken"("tokenHash");

CREATE INDEX "PersonalAccessToken_workspaceId_userId_idx" ON "PersonalAccessToken"("workspaceId", "userId");

CREATE INDEX "PersonalAccessToken_userId_idx" ON "PersonalAccessToken"("userId");

ALTER TABLE "PersonalAccessToken" ADD CONSTRAINT "PersonalAccessToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonalAccessToken" ADD CONSTRAINT "PersonalAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
