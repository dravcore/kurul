import { Controller, Get, UseGuards } from '@nestjs/common';
import type { UserDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AuthService } from './auth.service';

@Controller()
@UseGuards(SessionAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): UserDto {
    return this.authService.toUserDto(user);
  }
}
