import { Module } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { AccountController } from './account.controller';
import { InstanceAccountController } from './instance-account.controller';

/**
 * Account erasure: the user's own path and the instance operator's, over one engine.
 *
 * Its own module rather than a third method on `AuthModule`, because the boundary is different
 * in both directions. `AuthModule` is the session and the profile — things every request
 * touches; this is one irreversible operation guarded two different ways
 * (`SessionAuthGuard` alone for `/me`, `InstanceAdminGuard` for `/instance/users/:userId`), and
 * a reviewer auditing the promise in
 * `docs/decisions/0026-account-deletion-anonymisation.md` should have one small directory to
 * read rather than a grep through the auth module.
 *
 * No imports: `PrismaModule` is `@Global`, and the socket eviction the flow needs goes through
 * the process-wide hook in `realtime/workspace-socket-eviction.ts` — the same seam Better Auth's
 * own organization hooks use, and the reason this module does not depend on `RealtimeModule`.
 */
@Module({
  controllers: [AccountController, InstanceAccountController],
  providers: [AccountDeletionService],
})
export class AccountModule {}
