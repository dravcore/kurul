import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app';

/**
 * Tripwire for the three indexes the nightly retention sweeps stand on.
 *
 * Each sweep in `retention/cleanup.worker.ts` deletes by a date predicate, and the batch
 * `LIMIT` bounds how long a row lock is held rather than how much of the table is read — every
 * batch is its own scan. Without these indexes all three were sequential scans in the state
 * that matters, the steady state where the backlog is clean and the sweep finds nothing.
 * Measured at production-like volume before they were added (issue #187):
 *
 *   Session       Seq Scan, 516 buffers  →  Index Scan, 2 buffers
 *   Verification  Seq Scan, 206 buffers  →  Index Scan, 2 buffers
 *   UsagePing     Seq Scan, 416 buffers  →  Index Scan, 2 buffers
 *
 * **These tests deliberately do not assert a query plan.** The integration database holds a
 * handful of rows, and on a handful of rows a sequential scan is the *correct* plan — asserting
 * "Index Scan" here would either fail against a planner doing its job or pass for reasons that
 * have nothing to do with the index being right. What can be checked honestly is that the index
 * still exists and still leads with the column the sweep filters on, which is exactly what
 * breaks if someone drops it or reorders it. The measurement above is the evidence that it
 * matters; this is the tripwire that it is still there.
 */
describe('Retention sweep indexes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** `indexdef` for one index, or `undefined` when it does not exist. */
  async function definitionOf(indexName: string): Promise<string | undefined> {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${indexName}
    `;
    return rows[0]?.indexdef;
  }

  it.each([
    ['Session_expiresAt_idx', 'Session', 'expiresAt'],
    ['Verification_expiresAt_idx', 'Verification', 'expiresAt'],
    ['UsagePing_createdAt_idx', 'UsagePing', 'createdAt'],
  ])('%s leads with the column its sweep filters on', async (indexName, table, column) => {
    const indexdef = await definitionOf(indexName);

    expect(indexdef).toBeDefined();
    expect(indexdef).toContain(`ON public."${table}"`);
    // Leading column, not merely present: an index the predicate cannot lead with is an index
    // the sweep cannot use, which is the whole shape of the defect this closes.
    expect(indexdef).toMatch(new RegExp(`\\(\\s*"${column}"`));
  });

  it('keeps UsagePing_day_idx as well, because it serves a different reader', async () => {
    // `UsagePing_day_idx` backs the activation funnel's seven-day window; the sweep filters
    // `createdAt`. The schema comment used to claim one index served both, which is what let
    // the sweep go unindexed unnoticed. Losing either one is a regression in a different place.
    expect(await definitionOf('UsagePing_day_idx')).toBeDefined();
    expect(await definitionOf('UsagePing_createdAt_idx')).toBeDefined();
  });
});
