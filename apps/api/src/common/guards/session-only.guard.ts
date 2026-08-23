import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../types/request-context';

/**
 * Refuses a request that authenticated with a personal access token.
 *
 * The routes that manage tokens are the one place a token must not reach: a token that can
 * mint tokens is a credential that cannot be revoked by revoking it, and a token that can
 * list its siblings tells a thief which other secrets are worth looking for. `403` rather
 * than the tenant `404`, because there is nothing to hide about the route's existence; the
 * caller is a member, holding a credential of the wrong kind.
 *
 * Runs after the global `SessionAuthGuard`, which is what sets `request.accessToken`.
 */
@Injectable()
export class SessionOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (request.accessToken) {
      throw new ForbiddenException('This route requires a session, not an access token');
    }
    return true;
  }
}
