import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType } from '@kurul/shared-types';
import type { BoardDto, BoardTemplateDto, Locale } from '@kurul/shared-types';
import { ActivityService } from '../activity/activity.service';
import { defaultColumnsFor, type DefaultColumn } from '../common/board-defaults';
import { type DefaultLabel, boardTemplateFor, boardTemplatesFor } from '../common/board-templates';
import { assertBoard } from '../common/board-access';
import { fieldChanges } from '../common/field-changes';
import { LocaleService } from '../locale/locale.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBoardDto } from './dto/create-board.dto';
import type { UpdateBoardDto } from './dto/update-board.dto';

@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localeService: LocaleService,
    private readonly activityService: ActivityService,
  ) {}

  private toDto(row: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    createdAt: Date;
  }): BoardDto {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(workspaceId: string): Promise<BoardDto[]> {
    const boards = await this.prisma.board.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return boards.map((board) => this.toDto(board));
  }

  /**
   * The catalog of starting shapes, named in the reader's language.
   *
   * A read of code, not of rows, so it takes no workspace: the same four templates exist in
   * every workspace of every deployment. It is still mounted under `:workspaceId` because
   * `docs/api-conventions.md` allows no resource-bearing route outside the tenant scope, and
   * an unscoped route is one nobody can gate later without breaking clients.
   */
  async listTemplates(actorId: string, acceptLanguage?: string): Promise<BoardTemplateDto[]> {
    const locale = await this.localeService.resolve(actorId, acceptLanguage);
    return boardTemplatesFor(locale).map((template) => ({
      slug: template.slug,
      name: template.name,
      description: template.description,
      columns: template.columns.map(({ name, position, category }) => ({
        name,
        position,
        category,
      })),
      labels: template.labels.map(({ name, color }) => ({ name, color })),
    }));
  }

  /**
   * Creates a board with its starting columns and labels, named in the creator's language.
   *
   * The seed names are user data, not interface text (ADR 0018 §3): they are written once, in
   * whatever language the person creating the board reads, and belong to the board from then
   * on — a later viewer sees them as typed, not re-translated. `category` is what carries the
   * meaning across languages, so translating the labels cannot disturb the metrics (ADR 0019).
   *
   * **An omitted `template` is not the Kanban template.** It seeds Kanban's columns and no
   * labels, which is exactly what this endpoint did before templates existed. Making the two
   * identical was the tempting simplification and it is the wrong one: every client that has
   * ever called this route would start receiving labels it never asked for, on a board whose
   * label list it may well render as "the labels this team uses". A caller opts into the
   * preset by naming a template, and the picker names one on every create.
   */
  async create(
    workspaceId: string,
    actorId: string,
    dto: CreateBoardDto,
    acceptLanguage?: string,
  ): Promise<BoardDto> {
    const locale = await this.localeService.resolve(actorId, acceptLanguage);
    const { columns, labels } = this.seedFor(dto, locale);
    const board = await this.prisma.$transaction(async (tx) => {
      // Columns and labels in the one nested create the board already needed. A template that
      // wrote its labels afterwards could leave a board standing with half a preset if the
      // second write failed, and "half a preset" is indistinguishable from a team that deleted
      // the labels it did not want.
      const created = await tx.board.create({
        data: {
          workspaceId,
          name: dto.name,
          description: dto.description,
          columns: { create: columns },
          ...(labels.length > 0 ? { labels: { create: labels } } : {}),
        },
      });

      // In the same transaction as the board itself: an audit row that can outlive a rolled
      // back write would be a record of something that never happened.
      //
      // `seededColumns` rather than one `column.created` row per stage. The seed is not three
      // separate admin decisions — it is part of what "create a board" means — and the nested
      // create above does not return the column ids, so recording them individually would cost
      // a re-read on the hottest board write for rows nobody chose. The columns an operator
      // *did* choose (`POST .../columns`, `POST .../columns/defaults`) each get their own row.
      //
      // `template` is the slug and not the resolved names, because the names are already in
      // `seededColumns`: what the slug adds is *which shape was asked for*, which is the only
      // part a later reader cannot reconstruct from the rows. It is absent, not `null`, when
      // no template was named — the audit trail should not claim a choice nobody made.
      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.BoardCreated,
        payload: {
          boardId: created.id,
          name: created.name,
          seededColumns: columns.map((column) => column.name),
          ...(dto.template === undefined ? {} : { template: dto.template }),
          ...(labels.length > 0 ? { seededLabels: labels.map((label) => label.name) } : {}),
        },
      });

      return created;
    });
    return this.toDto(board);
  }

  /** The rows a create writes: a named template in full, or the default columns alone. */
  private seedFor(
    dto: CreateBoardDto,
    locale: Locale,
  ): { columns: DefaultColumn[]; labels: DefaultLabel[] } {
    if (dto.template === undefined) return { columns: defaultColumnsFor(locale), labels: [] };
    const template = boardTemplateFor(dto.template, locale);
    return { columns: template.columns, labels: template.labels };
  }

  async get(workspaceId: string, boardId: string): Promise<BoardDto> {
    return this.toDto(await assertBoard(this.prisma, workspaceId, boardId));
  }

  async update(
    workspaceId: string,
    boardId: string,
    actorId: string,
    dto: UpdateBoardDto,
  ): Promise<BoardDto> {
    const board = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the row can be
      // deleted, or moved to another workspace, before the write runs.
      //
      // The columns the audit row reports on are selected too, so "from" is the value this
      // transaction is actually replacing rather than one read before it started.
      const scoped = await tx.board.findFirst({
        where: { id: boardId, workspaceId },
        select: { id: true, name: true, description: true },
      });
      if (!scoped) throw new NotFoundException('Board not found');

      // The write predicate repeats the tenant scope: the check above only proves the row was
      // in the workspace when it ran, the predicate is what the database enforces.
      const updated = await tx.board.update({
        where: { id: boardId, workspaceId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
      });

      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.BoardUpdated,
        payload: {
          boardId,
          name: updated.name,
          changes: fieldChanges(scoped, updated, ['name', 'description']),
        },
      });

      return updated;
    });
    return this.toDto(board);
  }

  async remove(workspaceId: string, boardId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The name is read as well as the id: once the delete lands, this row is the only place
      // the board's name still exists, and "someone deleted board <uuid>" is not an answer
      // anybody can act on.
      const scoped = await tx.board.findFirst({
        where: { id: boardId, workspaceId },
        select: { id: true, name: true },
      });
      if (!scoped) throw new NotFoundException('Board not found');

      // Counted before the delete, for the same reason: the cascade takes the tasks with the
      // board, so afterwards there is nothing left to count. This is the number that says
      // whether the deletion was housekeeping or the loss of a quarter's work.
      const taskCount = await tx.task.count({ where: { boardId } });

      // Recorded before the delete and inside the same transaction. `Activity.workspaceId`
      // points at the workspace, not the board, so the cascade does not reach this row — and a
      // failed delete rolls the audit entry back with it (the same ordering `TaskService.remove`
      // uses).
      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.BoardDeleted,
        payload: { boardId, name: scoped.name, taskCount },
      });

      // deleteMany, not delete: it takes the same tenant predicate as the check above, so the
      // scope travels with the write instead of resting on the read.
      const { count } = await tx.board.deleteMany({ where: { id: boardId, workspaceId } });
      // Cross-workspace access is 404, never 403 (docs/api-conventions.md) — a 403 would
      // confirm the row exists.
      if (count === 0) throw new NotFoundException('Board not found');
    });
  }
}
