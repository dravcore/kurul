import { Module } from '@nestjs/common';
import { BoardController } from './board.controller';
import { BoardService } from './board.service';
import { ColumnController } from './column.controller';
import { ColumnService } from './column.service';

@Module({
  controllers: [BoardController, ColumnController],
  providers: [BoardService, ColumnService],
  exports: [BoardService, ColumnService],
})
export class BoardModule {}
