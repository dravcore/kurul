import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser, AuthedRequest } from '../types/request-context';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!request.user) {
      throw new Error('CurrentUser used without SessionAuthGuard');
    }
    return request.user;
  },
);
