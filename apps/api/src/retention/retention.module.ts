import { Module } from '@nestjs/common';
import { CleanupWorker } from './cleanup.worker';

/**
 * Data retention: the scheduled sweep that deletes rows the policy in ADR 0020 no longer
 * allows the database to hold.
 *
 * Its own module rather than a provider inside one of the feature modules, because it is the
 * only thing in the codebase that reaches across tenant and module boundaries by design — it
 * deletes from `Session`, `Verification`, `Notification` and `Activity`, which belong to
 * three different modules and to no workspace. Hanging it off `NotificationModule` (where the
 * other scheduled worker lives) would put an auth-table sweep behind a notifications import
 * and hide that fact from the module map.
 *
 * No controller and no exported provider: nothing in the API calls into retention, and there
 * is deliberately no route that triggers a sweep on demand.
 */
@Module({
  providers: [CleanupWorker],
})
export class RetentionModule {}
