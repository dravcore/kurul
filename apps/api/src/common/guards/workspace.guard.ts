import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MemberRole } from '@kurultay/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthedRequest, WorkspaceMembership } from '../types/request-context';

const ROLE_VALUES = new Set<string>(Object.values(MemberRole));

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const workspaceId = request.params.workspaceId;

    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new NotFoundException('Workspace not found');
    }

    const user = request.user;
    if (!user) {
      throw new NotFoundException('Workspace not found');
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user.id,
        },
      },
    });

    if (!membership || !ROLE_VALUES.has(membership.role)) {
      // Cross-tenant and non-member: 404, never 403.
      throw new NotFoundException('Workspace not found');
    }

    const resolved: WorkspaceMembership = {
      id: membership.id,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: membership.role as MemberRole,
    };

    request.membership = resolved;
    return true;
  }
}
