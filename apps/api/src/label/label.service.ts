import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType } from '@kurultay/shared-types';
import type { LabelDto } from '@kurultay/shared-types';
import { ActivityService } from '../activity/activity.service';
import { assertBoard } from '../common/board-access';
import { fieldChanges } from '../common/field-changes';
import { toLabelColorSlot } from '../common/label-color';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateLabelDto } from './dto/create-label.dto';
import type { UpdateLabelDto } from './dto/update-label.dto';

type LabelRow = {
  id: string;
  boardId: string;
  name: string;
  color: string;
};

@Injectable()
export class LabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  private toDto(row: LabelRow): LabelDto {
    return {
      id: row.id,
      boardId: row.boardId,
      name: row.name,
      color: toLabelColorSlot(row.color),
    };
  }

  async list(workspaceId: string, boardId: string): Promise<LabelDto[]> {
    await assertBoard(this.prisma, workspaceId, boardId);
    const labels = await this.prisma.label.findMany({
      where: { boardId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return labels.map((label) => this.toDto(label));
  }

  async create(
    workspaceId: string,
    boardId: string,
    actorId: string,
    dto: CreateLabelDto,
  ): Promise<LabelDto> {
    await assertBoard(this.prisma, workspaceId, boardId);
    const created = await this.prisma.label.create({
      data: {
        boardId,
        name: dto.name,
        color: dto.color,
      },
    });

    // Recorded after the insert instead of inside a transaction wrapped around both. The rule
    // across the audited writes is: join the transaction the mutation already owns, and open
    // none where there was none. That only ever leaves a *creation* unpaired, which is the case
    // it can afford — a lost `label.created` row still has the label itself standing as
    // evidence, whereas a lost deletion entry leaves nothing behind at all, which is why every
    // delete below records inside the transaction that performs it.
    await this.activityService.record(this.prisma, {
      workspaceId,
      userId: actorId,
      type: ActivityType.LabelCreated,
      payload: { labelId: created.id, boardId, name: created.name, color: created.color },
    });

    return this.toDto(created);
  }

  async update(
    workspaceId: string,
    labelId: string,
    actorId: string,
    dto: UpdateLabelDto,
  ): Promise<LabelDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the label can be
      // deleted, or its board moved to another workspace, before the write runs. The audited
      // columns come along, so `from` is what this transaction is actually replacing.
      const scoped = await tx.label.findFirst({
        where: { id: labelId, board: { workspaceId } },
        select: { id: true, boardId: true, name: true, color: true },
      });
      if (!scoped) throw new NotFoundException('Label not found');

      // The write predicate repeats the tenant scope (label → board → workspace): the check
      // above only proves the row was in the workspace when it ran, the predicate is what the
      // database enforces.
      const row = await tx.label.update({
        where: { id: labelId, board: { workspaceId } },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      });

      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.LabelUpdated,
        payload: {
          labelId,
          boardId: row.boardId,
          name: row.name,
          changes: fieldChanges(scoped, row, ['name', 'color']),
        },
      });

      return row;
    });
    return this.toDto(updated);
  }

  async remove(workspaceId: string, labelId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The name comes back too: deleting a label strips it from every task that carried it,
      // and "someone deleted label <uuid>" cannot be matched against what those tasks lost.
      const scoped = await tx.label.findFirst({
        where: { id: labelId, board: { workspaceId } },
        select: { id: true, boardId: true, name: true, color: true },
      });
      if (!scoped) throw new NotFoundException('Label not found');

      // Recorded before the delete and inside the same transaction, so a delete that never
      // lands takes its audit entry with it.
      await this.activityService.record(tx, {
        workspaceId,
        userId: actorId,
        type: ActivityType.LabelDeleted,
        payload: {
          labelId,
          boardId: scoped.boardId,
          name: scoped.name,
          color: scoped.color,
        },
      });

      // deleteMany, not delete: only deleteMany accepts a relation predicate, so the tenant
      // scope travels with the write instead of resting on the read.
      const { count } = await tx.label.deleteMany({
        where: { id: labelId, board: { workspaceId } },
      });
      // Cross-workspace access is 404, never 403 (docs/api-conventions.md) — a 403 would
      // confirm the row exists.
      if (count === 0) throw new NotFoundException('Label not found');
    });
  }
}
