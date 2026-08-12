import { Injectable, NotFoundException } from '@nestjs/common';
import type { BoardDto } from '@kurultay/shared-types';
import { defaultColumnsFor } from '../common/board-defaults';
import { assertBoard } from '../common/board-access';
import { LocaleService } from '../locale/locale.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBoardDto } from './dto/create-board.dto';
import type { UpdateBoardDto } from './dto/update-board.dto';

@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localeService: LocaleService,
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
   * Creates a board with its starting columns, named in the creator's language.
   *
   * The seed names are user data, not interface text (ADR 0018 §3): they are written once, in
   * whatever language the person creating the board reads, and belong to the board from then
   * on — a later viewer sees them as typed, not re-translated. `category` is what carries the
   * meaning across languages, so translating the labels cannot disturb the metrics (ADR 0019).
   */
  async create(
    workspaceId: string,
    actorId: string,
    dto: CreateBoardDto,
    acceptLanguage?: string,
  ): Promise<BoardDto> {
    const locale = await this.localeService.resolve(actorId, acceptLanguage);
    const board = await this.prisma.$transaction((tx) =>
      tx.board.create({
        data: {
          workspaceId,
          name: dto.name,
          description: dto.description,
          columns: { create: defaultColumnsFor(locale) },
        },
      }),
    );
    return this.toDto(board);
  }

  async get(workspaceId: string, boardId: string): Promise<BoardDto> {
    return this.toDto(await assertBoard(this.prisma, workspaceId, boardId));
  }

  async update(workspaceId: string, boardId: string, dto: UpdateBoardDto): Promise<BoardDto> {
    const board = await this.prisma.$transaction(async (tx) => {
      // Read inside the transaction: a read outside it leaves a window in which the row can be
      // deleted, or moved to another workspace, before the write runs.
      const scoped = await tx.board.findFirst({
        where: { id: boardId, workspaceId },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Board not found');

      // The write predicate repeats the tenant scope: the check above only proves the row was
      // in the workspace when it ran, the predicate is what the database enforces.
      return tx.board.update({
        where: { id: boardId, workspaceId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
      });
    });
    return this.toDto(board);
  }

  async remove(workspaceId: string, boardId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const scoped = await tx.board.findFirst({
        where: { id: boardId, workspaceId },
        select: { id: true },
      });
      if (!scoped) throw new NotFoundException('Board not found');

      // deleteMany, not delete: it takes the same tenant predicate as the check above, so the
      // scope travels with the write instead of resting on the read.
      const { count } = await tx.board.deleteMany({ where: { id: boardId, workspaceId } });
      // Cross-workspace access is 404, never 403 (docs/api-conventions.md) — a 403 would
      // confirm the row exists.
      if (count === 0) throw new NotFoundException('Board not found');
    });
  }
}
