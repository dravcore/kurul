import { Injectable, NotFoundException } from '@nestjs/common';
import type { BoardDto } from '@kurultay/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBoardDto } from './dto/create-board.dto';
import type { UpdateBoardDto } from './dto/update-board.dto';

@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(workspaceId: string, dto: CreateBoardDto): Promise<BoardDto> {
    const board = await this.prisma.$transaction((tx) =>
      tx.board.create({
        data: {
          workspaceId,
          name: dto.name,
          description: dto.description,
          columns: {
            create: [
              { name: 'To Do', position: 1000 },
              { name: 'In Progress', position: 2000 },
              { name: 'Done', position: 3000 },
            ],
          },
        },
      }),
    );
    return this.toDto(board);
  }

  async get(workspaceId: string, boardId: string): Promise<BoardDto> {
    return this.toDto(await this.findBoard(workspaceId, boardId));
  }

  async update(workspaceId: string, boardId: string, dto: UpdateBoardDto): Promise<BoardDto> {
    await this.findBoard(workspaceId, boardId);
    const board = await this.prisma.board.update({
      where: { id: boardId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
    return this.toDto(board);
  }

  async remove(workspaceId: string, boardId: string): Promise<void> {
    await this.findBoard(workspaceId, boardId);
    await this.prisma.board.delete({ where: { id: boardId } });
  }

  private async findBoard(workspaceId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, workspaceId },
    });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }
}
