import { Injectable } from '@nestjs/common';
import type { Locale, UserDto } from '@kurultay/shared-types';
import { LocaleService } from '../locale/locale.service';
import type { AuthenticatedUser } from '../common/types/request-context';
import type { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class AuthService {
  constructor(private readonly localeService: LocaleService) {}

  /**
   * The signed-in user as the web sees them.
   *
   * `locale` costs a primary-key lookup rather than riding along on the session, because the
   * session user is cached in a cookie for five minutes and this endpoint is what the web's
   * locale resolution chain reads — a stale value here means the interface does not change
   * language until the cache expires. See `LocaleService`.
   */
  async me(user: AuthenticatedUser): Promise<UserDto> {
    return this.toUserDto(user, await this.localeService.read(user.id));
  }

  /** Applies a profile patch and answers with the user in its post-write state. */
  async updateMe(user: AuthenticatedUser, dto: UpdateMeDto): Promise<UserDto> {
    // `undefined` means the client did not mention the field; `null` means "clear it". Only
    // the former leaves the stored value alone.
    if (dto.locale === undefined) {
      return this.me(user);
    }
    return this.toUserDto(user, await this.localeService.write(user.id, dto.locale));
  }

  toUserDto(user: AuthenticatedUser, locale: Locale | null): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      locale,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
