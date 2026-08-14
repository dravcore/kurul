-- The one table the activation funnel needed that the product did not already have.
-- Everything else the funnel reports is an aggregate over User, WorkspaceMember and Activity;
-- this holds the two questions those cannot answer, because Activity only records writes and a
-- team that reads its board and changes nothing writes nothing. See the doc comment on
-- `model UsagePing` in schema.prisma and docs/decisions/0021-activation-funnel-and-opt-in-telemetry.md.
--
-- `prisma migrate dev` also wanted to emit four `ALTER TABLE … ALTER COLUMN "updatedAt" DROP
-- DEFAULT` statements against User/Session/Account/Verification. They are pre-existing drift
-- between the checked-in migrations and the schema, unrelated to this change, and dropping a
-- default on a column the auth tables are written through is not a thing to do as a side effect
-- of adding a metrics table. Removed on purpose; whoever fixes that drift should do it in a
-- migration that says so.

-- CreateTable
CREATE TABLE "UsagePing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsagePing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsagePing_day_idx" ON "UsagePing"("day");

-- CreateIndex
CREATE INDEX "UsagePing_workspaceId_idx" ON "UsagePing"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "UsagePing_userId_workspaceId_kind_day_key" ON "UsagePing"("userId", "workspaceId", "kind", "day");

-- AddForeignKey
ALTER TABLE "UsagePing" ADD CONSTRAINT "UsagePing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsagePing" ADD CONSTRAINT "UsagePing_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
