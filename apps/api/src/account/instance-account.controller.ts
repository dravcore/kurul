import { Body, Controller, Delete, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import type { AccountDeletionPreviewDto } from '@kurultay/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/decorators/uuid-param.decorator';
import { InstanceAdminGuard } from '../common/guards/instance-admin.guard';
import type { AuthenticatedUser } from '../common/types/request-context';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

/**
 * Executing an erasure request on somebody else's behalf.
 *
 * This exists because the self-service path cannot cover the case that actually arrives. A
 * GDPR Article 17 / KVKK Article 7 request reaches a self-hoster as an e-mail, usually from
 * someone who has already stopped using the account and sometimes from someone who never had a
 * working password. Without this route the operator is back where audit finding DB-05 started:
 * at `psql`, where the `DELETE` fails on the first of seven `Restrict` foreign keys.
 *
 * `InstanceAdminGuard`, so the boundary is the deployment's own configuration — an operator who
 * can already read `DATABASE_URL` names the accounts allowed to do this in
 * `INSTANCE_ADMIN_EMAILS`, and **unset means nobody**. The guard's own doc comment argues out
 * the three alternatives, including the `User.isAdmin` column this route would otherwise be the
 * second reason to add.
 *
 * `403`, not the `404` a workspace route answers. Same reasoning as `ActivationController`:
 * that 404 exists to stop a cross-tenant probe distinguishing "forbidden" from "does not
 * exist", and here there is nothing to hide — the route is in the source of an AGPL project.
 * A 403 tells an operator who forgot the variable what is actually wrong.
 *
 * The operator's identity is recorded in the `account.deleted` JSON log line and **nowhere
 * else** — deliberately not in the `Activity` rows this writes into each of the target's
 * workspaces, because an instance operator is not a member of those tenants and their name has
 * no business appearing in a tenant's feed
 * (`docs/decisions/0026-account-deletion-anonymisation.md`).
 */
@Controller('instance/users')
@UseGuards(InstanceAdminGuard)
export class InstanceAccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  /**
   * What deleting this account would do.
   *
   * The operator reads this before deciding, exactly as the user does — and needs it more,
   * because they cannot see the person's workspaces any other way. It is also what makes the
   * ≤30-minute target reachable without a database session: the sole-owned workspaces and
   * their transfer candidates are on the screen.
   */
  @Get(':userId/deletion-preview')
  preview(@UuidParam('userId') userId: string): Promise<AccountDeletionPreviewDto> {
    return this.deletion.preview(userId);
  }

  /**
   * Deletes the named account. `204`.
   *
   * `confirmEmail` has to match the target's address, and on this path it is doing more work
   * than on the self-service one: a UUID in a URL is unreadable, and a mistyped one is a
   * different person whose data would be destroyed instead.
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @UuidParam('userId') userId: string,
    @Body() dto: DeleteAccountDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.deletion.deleteAccount(userId, dto, 'instance_admin', actor.id);
  }
}
