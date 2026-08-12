import { Injectable, NotFoundException } from '@nestjs/common';
import type { LabelDto } from '@kurultay/shared-types';
import { assertBoard } from '../common/board-access';
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
  constructor(private readonly prisma: PrismaService) {}

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

  async create(workspaceId: string, boardId: string, dto: CreateLabelDto): Promise<LabelDto> {
    await assertBoard(this.prisma, workspaceId, boardId);
    const created = await this.prisma.label.create({
      data: {
        boardId,
        name: dto.name,
        color: dto.color,
      },
    });
    return this.toDto(created);
  }

  async update(workspaceId: string, labelId: string, dto: UpdateLabelDto): Promise<LabelDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the label can be
      // deleted, or its board moved to another workspace, before the write runs.
      const scoped = await tx.label.findFirst({
        where: { id: labelId, board: { workspaceId } },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Label not found');

      // The write predicate repeats the tenant scope (label → board → workspace): the check
      // above only proves the row was in the workspace when it ran, the predicate is what the
      // database enforces.
      return tx.label.update({
        where: { id: labelId, board: { workspaceId } },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
        },
      });
    });
    return this.toDto(updated);
  }

  async remove(workspaceId: string, labelId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const scoped = await tx.label.findFirst({
        where: { id: labelId, board: { workspaceId } },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Label not found');

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
