-- Per-workspace plan-limit override (ADR 0032).
--
-- Nullable JSONB with no default: null is "this workspace has no override", which is what
-- every existing row means and what a new row means until hosted billing (ADR 0028) writes
-- one. Adding a nullable column with no default is metadata-only, so the table is not
-- rewritten. JSONB rather than JSON: the resolver reads keys, never the original text, and
-- jsonb is what Prisma's `Json` maps to on PostgreSQL anyway.
ALTER TABLE "Workspace" ADD COLUMN "planLimits" JSONB;
