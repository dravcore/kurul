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
    await this.findLabel(workspaceId, labelId);
    const updated = await this.prisma.label.update({
      where: { id: labelId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      },
    });
    return this.toDto(updated);
  }

  async remove(workspaceId: string, labelId: string): Promise<void> {
    await this.findLabel(workspaceId, labelId);
    await this.prisma.label.delete({ where: { id: labelId } });
  }

  private async findLabel(workspaceId: string, labelId: string) {
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, board: { workspaceId } },
    });
    if (!label) throw new NotFoundException('Label not found');
    return label;
  }
}
