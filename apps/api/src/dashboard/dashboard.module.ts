import { Module } from '@nestjs/common';
import { ActivationModule } from '../activation/activation.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  // For `UsagePingService` only: opening the dashboard is one of the two funnel steps that
  // leaves no other trace, and it is recorded where the view actually happens.
  imports: [ActivationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
