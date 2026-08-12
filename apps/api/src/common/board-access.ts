import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

type BoardDb = Pick<PrismaService, 'board'> | { board: PrismaService['board'] };

export async function assertBoard(db: BoardDb, workspaceId: string, boardId: string) {
  const board = await db.board.findFirst({ where: { id: boardId, workspaceId } });
  if (!board) throw new NotFoundException('Board not found');
  return board;
}
