import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { demoModeEnabled } from './demo-mode';

/**
 * Refuses an action that a public demo cannot afford to let a stranger take.
 *
 * The list it guards is deliberately two routes long — `DELETE /me` and
 * `DELETE /workspaces/:workspaceId` — and both are on it for the same reason, which is worth
 * stating so the list does not grow by vibes:
 *
 * > **They destroy something a *different* visitor is using, and the hourly reset is not a
 * > recovery path for the person it happened to.**
 *
 * A demo instance is one shared workspace that everybody signs into. Deleting it, or deleting
 * the account that owns it, empties the demo for every concurrent visitor until the next
 * reset — up to an hour of a launch-day link pointing at an empty board. Nothing else in the
 * product has that blast radius: deleting a task, a board or a comment is exactly the thing a
 * demo is for, and the reset is precisely what makes it safe.
 *
 * What is **not** on the list, on purpose:
 *
 * - **Sign-up.** A demo where nobody can register is a demo of a login screen. Rate limiting
 *   (`auth-rate-limit.ts`) is the answer to abuse there, not a switch.
 * - **Attachment upload.** Already bounded by the per-workspace quota and the upload budget
 *   (ADR 0027), which is configuration an operator sets low on a demo host rather than a
 *   second mechanism that turns the feature off.
 * - **Invitations.** Not blocked, because `DEMO_MODE` already routes mail to the log
 *   transport (`createMailSender`): an invitation can be created and its link copied, and the
 *   API reports `NOT_CONFIGURED` for the email, which is the truth and a state the members
 *   screen already renders. Refusing the route as well would be a second answer to the same
 *   question, free to disagree with the first.
 *
 * `403` with the ordinary error envelope, like `InstanceAdminGuard`: there is nothing to hide
 * — the deployment publishes `demo.enabled` on `GET /config` — and a `404` would tell an
 * operator testing their own demo host that the route does not exist.
 *
 * A guard rather than a check inside each service, because the decision is about the
 * *deployment* and not about the request's arguments: nothing in either service body would
 * read differently, and a guard is the one place a reviewer can enumerate the whole list.
 * Attached per handler with `@UseGuards` rather than registered globally with a decorator and
 * `Reflector`, for the same reason: a global guard would be asked this question on every
 * request in the API to answer it for two of them.
 */
@Injectable()
export class DemoRestrictedGuard implements CanActivate {
  canActivate(): boolean {
    if (demoModeEnabled()) {
      throw new ForbiddenException(
        'This action is disabled on the demo instance. The demo resets on its own schedule.',
      );
    }

    return true;
  }
}
