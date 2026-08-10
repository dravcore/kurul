import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';
import { closeSharedDatabase, createSharedPrismaAdapter, registerPoolConsumer } from './database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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

  async onModuleDestroy(): Promise<void> {
    await closeSharedDatabase();
  }
}
