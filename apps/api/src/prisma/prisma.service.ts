import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';
import { closeSharedDatabase, createSharedPrismaAdapter, registerPoolConsumer } from './database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor() {
    super({ adapter: createSharedPrismaAdapter() });
    // `database.ts` owns pool shutdown: it disconnects registered clients and only then ends
    // the pool, so this client is never left issuing queries against a dead pool (or ending
    // a pool Better Auth's client is still using) whatever order Nest fires destroy hooks in.
    registerPoolConsumer(() => this.$disconnect());
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Shutdown, not destroy: destroy hooks run while the HTTP listener is still accepting and
   * serving, so ending the pool there fails every request that was in flight when SIGTERM
   * arrived. See the phase-ordering note on `enableShutdownHooks` in `main.ts`.
   */
  async onApplicationShutdown(): Promise<void> {
    await closeSharedDatabase();
  }
}
