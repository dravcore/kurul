import { Injectable } from '@nestjs/common';
import type { UserDto } from '@kurultay/shared-types';
import type { AuthenticatedUser } from '../common/types/request-context';

@Injectable()
export class AuthService {
  toUserDto(user: AuthenticatedUser): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
