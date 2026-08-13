import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RedisHealthClient } from './redis-health.client';

@Module({
  // `PrismaService` comes from the global `PrismaModule`; the Redis probe owns its own client
  // rather than borrowing the gateway's adapter pair — see `redis-health.client.ts`.
  controllers: [HealthController],
  providers: [HealthService, RedisHealthClient],
})
export class HealthModule {}
