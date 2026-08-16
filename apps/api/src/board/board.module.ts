import { Module } from '@nestjs/common';
import { ActivationModule } from '../activation/activation.module';
import { ActivityModule } from '../activity/activity.module';
import { LocaleModule } from '../locale/locale.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BoardController } from './board.controller';
import { BoardService } from './board.service';
import { ColumnController } from './column.controller';
import { ColumnService } from './column.service';

@Module({
  // `ActivationModule` is here for `UsagePingService` alone — opening a board is the
  // `wau_board_view` funnel step, recorded on `GET :boardId` where the view actually happens.
  imports: [ActivationModule, ActivityModule, RealtimeModule, LocaleModule],
  controllers: [BoardController, ColumnController],
  providers: [BoardService, ColumnService],
  exports: [BoardService, ColumnService],
})
export class BoardModule {}
