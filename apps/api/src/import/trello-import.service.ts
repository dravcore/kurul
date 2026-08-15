import { Injectable } from '@nestjs/common';
import { ActivityType } from '@kurultay/shared-types';
import type { TrelloImportReportDto } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMPORT_CHUNK_SIZE,
  TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS,
  TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS,
  chunked,
} from './import-config';
import { parseTrelloExport } from './trello-export';
import { importedCounts, planTrelloImport } from './trello-import-planner';

/**
 * One-way Trello board import.
 *
 * The shape is deliberate and it is the opposite of every other write service here: all of the
 * decision-making happens *before* the transaction opens, in `parseTrelloExport` and
 * `planTrelloImport`, neither of which touches a database. Inside the transaction there are no
 * branches, no lookups and no "skip this one and carry on" — every row that reaches it is already
 * known to be writable (ADR 0025).
 *
 * That is what makes the board atomic while the *coverage* is partial: a failure rolls back a
 * whole board rather than leaving a half-imported one, and the report describes what was never
 * going to be written rather than what happened to fail.
 *
 * **Nothing is broadcast.** `RealtimeService` is not injected and this file does not name it. An
 * import creates a *new* board, and a new board's socket room has nobody in it; emitting into it
 * would be writing to a channel with no reader (ADR 0025). The absence is the decision, so it is
 * pinned by a test that reads this file rather than by a mock that would never be called either
 * way.
 */
@Injectable()
export class TrelloImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Reads, plans and writes an export, answering with the report.
   *
   * `workspaceId` is not re-checked here, and that is not an omission. `WorkspaceGuard` has
   * already resolved membership and owns the 404-not-403 rule; `Board.workspaceId` is a foreign
   * key, so a workspace that does not exist produces a `P2003` that `mapPrismaError` already
   * translates (ADR 0016). A second `findFirst` would ask a question the guard has answered.
   */
  async importBoard(
    workspaceId: string,
    actorId: string,
    bytes: Buffer,
  ): Promise<TrelloImportReportDto> {
    // Throws only for the two "this is not the file you think it is" cases; everything else the
    // reader could not understand arrives as issues the planner folds into the report.
    const read = parseTrelloExport(bytes);
    const plan = planTrelloImport(read, { actorId });
    const imported = importedCounts(plan);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.board.create({
          data: {
            id: plan.board.id,
            workspaceId,
            name: plan.board.name,
            description: plan.board.description,
          },
        });
        // Every list goes through `chunked`, including the short ones, and that has a second
        // effect worth having: an empty run yields no chunks at all, so an empty board costs one
        // `INSERT` rather than seven `createMany({ data: [] })` round trips inside the
        // longest-lived transaction this API opens.
        for (const chunk of chunked(plan.columns, IMPORT_CHUNK_SIZE)) {
          await tx.column.createMany({ data: chunk });
        }
        for (const chunk of chunked(plan.labels, IMPORT_CHUNK_SIZE)) {
          await tx.label.createMany({ data: chunk });
        }
        // Tasks after columns, and it is a constraint rather than a preference: `Task.column` is
        // a composite foreign key on `(boardId, columnId)` (`schema.prisma`), so every row here
        // needs its column to exist already.
        for (const chunk of chunked(plan.tasks, IMPORT_CHUNK_SIZE)) {
          await tx.task.createMany({ data: chunk });
        }
        for (const chunk of chunked(plan.taskLabels, IMPORT_CHUNK_SIZE)) {
          await tx.taskLabel.createMany({ data: chunk });
        }
        for (const chunk of chunked(plan.checklists, IMPORT_CHUNK_SIZE)) {
          await tx.checklist.createMany({ data: chunk });
        }
        for (const chunk of chunked(plan.checklistItems, IMPORT_CHUNK_SIZE)) {
          await tx.checklistItem.createMany({ data: chunk });
        }
        for (const chunk of chunked(plan.attachments, IMPORT_CHUNK_SIZE)) {
          await tx.attachment.createMany({ data: chunk });
        }

        // Inside the transaction, like every audited write in this codebase: an activity row that
        // outlived a rolled-back import would record a board that does not exist.
        //
        // Exactly one row, not one `task.created` per card. Telling a user "500 cards were
        // created" with 500 rows splits one event into 500, and it is the volume ADR 0024 names
        // when it explains what may not enter the audit subset.
        await this.activity.record(tx, {
          workspaceId,
          userId: actorId,
          type: ActivityType.BoardImported,
          payload: {
            boardId: plan.board.id,
            name: plan.board.name,
            source: 'trello',
            imported,
            skippedTotal: plan.skipped.reduce((total, group) => total + group.count, 0),
          },
        });
      },
      {
        maxWait: TRELLO_IMPORT_TRANSACTION_MAX_WAIT_MS,
        // Without this, Prisma's unconfigured 5-second default applies and a realistically sized
        // import fails as a `P2028` that reads like a bug in this code. See `import-config.ts`.
        timeout: TRELLO_IMPORT_TRANSACTION_TIMEOUT_MS,
      },
    );

    return {
      boardId: plan.board.id,
      boardName: plan.board.name,
      imported,
      skipped: plan.skipped,
    };
  }
}
