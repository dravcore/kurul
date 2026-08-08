import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole } from '@kurultay/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthedRequest } from '../types/request-context';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const role = request.membership?.role;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
