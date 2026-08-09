import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest, WorkspaceMembership } from '../types/request-context';

export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceMembership => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!request.membership) {
      throw new Error('CurrentMembership used without WorkspaceGuard');
    }
    return request.membership;
  },
);
