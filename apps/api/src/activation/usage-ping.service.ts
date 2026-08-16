import { Injectable, Logger } from '@nestjs/common';
import type { UsagePingKind } from '@kurul/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * UTC midnight of the day `at` falls on.
 *
 * `Date.UTC` and not `setHours(0,0,0,0)`: an instance running with `TZ=Europe/Istanbul` would
 * otherwise bucket a 01:00 local view into the *previous* UTC day, so two replicas of the same
 * deployment in different zones would write two rows for one visit and the dedupe would stop
 * deduplicating. `dashboard.service.ts` documents the same trap at length for `date_trunc`.
 */
export function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Records that somebody *looked* at something — the only write path the activation funnel adds.
 *
 * Nine of the funnel's eleven steps are aggregates over rows the product already wrote. These
 * two are not, because `Activity` records changes and looking is not a change; see the doc
 * comment on `model UsagePing` for why measuring retention without them would report quiet
 * healthy instances as dead.
 *
 * The write is deduplicated to one row per (user, workspace, kind, UTC day) by a unique index
 * and `ON CONFLICT DO NOTHING`, which is what keeps this from becoming a browsing history: the
 * hundredth board view of a Tuesday costs one index probe and stores nothing.
 */
@Injectable()
export class UsagePingService {
  private readonly logger = new Logger(UsagePingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `createMany` with `skipDuplicates` rather than `upsert`: an upsert is a read then a write,
   * and there is nothing to update — the row's entire content is its key. This compiles to a
   * single `INSERT … ON CONFLICT DO NOTHING`, so the steady state (every view after the first
   * of the day) is one index probe and no row written, and two concurrent tabs cannot race
   * each other into a unique-violation.
   */
  async record(
    userId: string,
    workspaceId: string,
    kind: UsagePingKind,
    now: Date = new Date(),
  ): Promise<void> {
    await this.prisma.usagePing.createMany({
      data: [{ userId, workspaceId, kind, day: utcDayStart(now) }],
      skipDuplicates: true,
    });
  }

  /**
   * Fire-and-forget: record the ping, and never let it affect the response.
   *
   * This is called from `GET` handlers, which is the one thing about this design worth arguing
   * with — a read that writes. It is deliberate and it is bounded by these two rules:
   *
   * 1. **It is not awaited.** The board loads at exactly the speed it did before; the insert
   *    happens on its own, after the handler has already returned its DTO.
   * 2. **It cannot fail the request.** Every error is swallowed into a `warn`. A metrics table
   *    being full, locked or missing is not a reason a team cannot see their board, and there
   *    is no state the caller could repair by being told.
   *
   * The alternative — a `POST /usage` the browser calls on mount — was rejected for costing a
   * second round trip per page view and for putting the truth of "did they open the board" in
   * client code that an extension can block, to buy back an HTTP verb's purity that nothing
   * downstream reads (there is no cache and no read replica in this deployment).
   */
  recordQuietly(userId: string, workspaceId: string, kind: UsagePingKind): void {
    void this.record(userId, workspaceId, kind).catch((error: unknown) => {
      this.logger.warn(
        `usage ping (${kind}) not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
