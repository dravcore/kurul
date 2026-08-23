import { Global, Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';

/**
 * Global for the same reason `AuthModule` is: `SessionAuthGuard` resolves Bearer tokens through
 * `TokenService`, and Nest instantiates that guard inside every module that names it in
 * `@UseGuards` (`AuthController`, `AccountController`) as well as once for the `APP_GUARD`.
 * Listing this module in each of those imports would be three restatements of one dependency.
 * `WorkspaceMemberService` uses the same export to revoke a departing member's tokens.
 */
@Global()
@Module({
  imports: [ActivityModule],
  controllers: [TokenController],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokenModule {}
