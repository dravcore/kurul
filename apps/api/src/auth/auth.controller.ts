import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { UserDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AuthService } from './auth.service';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller()
@UseGuards(SessionAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    return this.authService.me(user);
  }

  /**
   * The user's own profile. Not workspace-scoped and deliberately not role-gated: the subject
   * is the caller, so `SessionAuthGuard` is the whole authorization story.
   */
  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto): Promise<UserDto> {
    return this.authService.updateMe(user, dto);
  }
}
