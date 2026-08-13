import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceInvitationService, WorkspaceMemberService],
  exports: [WorkspaceService, WorkspaceInvitationService, WorkspaceMemberService],
})
export class WorkspaceModule {}
