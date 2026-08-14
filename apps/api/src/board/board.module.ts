import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { LocaleModule } from '../locale/locale.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BoardController } from './board.controller';
import { BoardService } from './board.service';
import { ColumnController } from './column.controller';
import { ColumnService } from './column.service';

@Module({
  imports: [ActivityModule, RealtimeModule, LocaleModule],
  controllers: [BoardController, ColumnController],
  providers: [BoardService, ColumnService],
  exports: [BoardService, ColumnService],
})
export class BoardModule {}
