import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { closeSharedDatabase } from '../prisma/database';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionAuthGuard, WorkspaceGuard, RolesGuard],
  exports: [AuthService, SessionAuthGuard, WorkspaceGuard, RolesGuard],
})
export class AuthModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    // Both this hook and PrismaService's call the same idempotent shutdown. Whichever Nest
    // happens to run first disconnects every registered client and then ends the shared pool;
    // the other awaits that same promise. `auth.ts` registers the Better Auth client when it
    // is loaded (via SessionAuthGuard above), so it is drained here even though this module
    // no longer disconnects it directly.
    await closeSharedDatabase();
  }
}
