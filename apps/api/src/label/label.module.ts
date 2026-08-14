import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { LabelController } from './label.controller';
import { LabelService } from './label.service';

@Module({
  imports: [ActivityModule],
  controllers: [LabelController],
  providers: [LabelService],
  exports: [LabelService],
})
export class LabelModule {}
