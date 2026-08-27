import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PlanLimitsService } from './plan-limits.service';

/**
 * The plan-limit layer (ADR 0032).
 *
 * Global-ish in reach but not `@Global()`: six modules import it explicitly (workspace,
 * board, import, attachment, config, and the Better Auth mount through `app.get`), and naming
 * them is how the dependency stays visible in the import lists rather than appearing out of the
 * ambient container. It imports `StorageModule` because the byte quotas are members of the
 * same object as the counts.
 */
@Module({
  imports: [StorageModule],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanModule {}
