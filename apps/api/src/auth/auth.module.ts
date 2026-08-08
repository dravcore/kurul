import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { disconnectAuthDatabase } from './auth';
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
    await disconnectAuthDatabase();
  }
}
