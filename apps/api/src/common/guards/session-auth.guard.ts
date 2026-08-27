import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../auth/auth';
import { parseBearerHeader } from '../../token/personal-access-token';
import { TokenService } from '../../token/token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser, AuthedRequest } from '../types/request-context';

/**
 * The one gate every non-`@Public()` route sits behind. Two credentials are accepted, and a
 * request presents one of them:
 *
 * - **A session cookie**, resolved by Better Auth. The browser path, unchanged.
 * - **A personal access token** in `Authorization: Bearer kurul_pat_...`, resolved by
 *   `TokenService`. Decided first, and decided alone: a request that carries a Bearer header
 *   is never answered from its cookies, so a client that sends a token gets the identity it
 *   asked for or a `401`, and a stale browser cookie can never quietly widen a script's reach.
 *
 * Either way the request leaves here with `request.user` set, which is the whole contract
 * `RolesGuard`, `WorkspaceGuard` and every controller rely on; a token request additionally
 * carries `request.accessToken`, which is how `WorkspaceGuard` pins it to one workspace.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();

    const bearer = parseBearerHeader(request.headers.authorization);
    if (bearer.kind !== 'absent') {
      request.user = await this.authenticateToken(request, bearer);
      return true;
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session?.user) {
      throw new UnauthorizedException('Authentication required');
    }

    const user: AuthenticatedUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      avatarUrl: session.user.image ?? null,
      emailVerified: session.user.emailVerified,
      createdAt: new Date(session.user.createdAt),
    };

    request.user = user;
    return true;
  }

  private async authenticateToken(
    request: AuthedRequest,
    bearer: ReturnType<typeof parseBearerHeader>,
  ): Promise<AuthenticatedUser> {
    if (bearer.kind !== 'token') {
      throw new UnauthorizedException('Authentication required');
    }

    const resolved = await this.tokenService.resolve(bearer.plaintext);
    if (!resolved) {
      // Unknown, revoked and expired all read the same from outside, on purpose.
      throw new UnauthorizedException('Authentication required');
    }

    // A token is scoped to one workspace, and that scope has to be checkable. Every
    // resource-bearing route carries `:workspaceId` (api-conventions.md, "Workspace scoping"),
    // and `WorkspaceGuard` compares it against the token's. The routes that carry none,
    // `/me`, `GET /workspaces`, `/instance/*`, are about the account or the instance rather
    // than a tenant, so there is no scope to compare and the token is refused outright. `403`
    // rather than `404`: the route exists and the credential is valid, it is the wrong kind
    // for this route, and saying so is what lets a script author fix their script.
    const workspaceId: unknown = request.params?.workspaceId;
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new ForbiddenException(
        'An access token is bound to one workspace and cannot call this route',
      );
    }

    // Pinned here as well as in `WorkspaceGuard`, because one workspace-addressed route is
    // deliberately not membership-gated (accepting an invitation) and a token for workspace A
    // must not be able to act on workspace B through it. Same `404` as a non-member gets.
    if (workspaceId !== resolved.workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    request.accessToken = { id: resolved.id, workspaceId: resolved.workspaceId };
    return resolved.user;
  }
}
