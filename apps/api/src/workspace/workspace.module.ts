import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceInvitationService],
  exports: [WorkspaceService, WorkspaceInvitationService],
})
export class WorkspaceModule {}
