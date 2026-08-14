import { ActivationEvent } from '@kurultay/shared-types';
import type { ActivationFunnelDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';

/**
 * The instance's own activation funnel — instance-wide, so nothing about this request is
 * workspace-scoped and no workspace id belongs in the path.
 *
 * The API answers `403` to anybody not listed in the deployment's `INSTANCE_ADMIN_EMAILS`,
 * which on a default install is everybody. That is why the caller renders nothing on failure
 * rather than reporting an error: for almost every signed-in user a refusal here is the normal,
 * correct answer and not something they can act on.
 *
 * Takes the `AbortSignal` positionally rather than a whole `RequestInit`, so it is directly
 * the shape `useApiResource` calls — one reader, no wrapper closure at the call site that
 * would be a new function on every render and refetch the resource on every commit.
 */
export function fetchActivationFunnel(signal?: AbortSignal): Promise<ActivationFunnelDto> {
  return api.get<ActivationFunnelDto>('/instance/activation', { signal });
}

/**
 * Translation key per step, written out rather than derived from the event name.
 *
 * `t(\`steps.${event}\`)` would be shorter and would defeat `messages/catalog.test.ts`, which
 * proves every catalogue key is rendered somewhere by looking for the key path as a literal.
 * A template would make all eleven of these look orphaned, and the next person to add a
 * language would translate — or delete — them on that evidence.
 */
export const ACTIVATION_STEP_LABEL_KEYS: Readonly<Record<ActivationEvent, string>> = {
  [ActivationEvent.UserRegistered]: 'steps.user_registered',
  [ActivationEvent.WorkspaceCreated]: 'steps.workspace_created',
  [ActivationEvent.BoardCreated]: 'steps.board_created',
  [ActivationEvent.FirstTaskCreated]: 'steps.first_task_created',
  [ActivationEvent.FirstDrag]: 'steps.first_drag',
  [ActivationEvent.InviteSent]: 'steps.invite_sent',
  [ActivationEvent.SmtpConfigured]: 'steps.smtp_configured',
  [ActivationEvent.InviteAccepted]: 'steps.invite_accepted',
  [ActivationEvent.DashboardViewed]: 'steps.dashboard_viewed',
  [ActivationEvent.TaskCompleted]: 'steps.task_completed',
  [ActivationEvent.WauBoardView]: 'steps.wau_board_view',
};

/**
 * Bar width as a percentage of the funnel's widest headcount.
 *
 * The denominator is the largest `users` step rather than the first one. They are almost always
 * the same (`user_registered` is a superset of every step after it), but "almost always" is not
 * a thing to divide by: an instance seeded by a migration, or one where an account was deleted
 * after doing the work, can legitimately have a later step exceed the first — and dividing by a
 * smaller number than the maximum would draw a bar past the edge of its own track.
 *
 * `instance` steps are excluded from the denominator *and* get no bar: `1` on a boolean is not
 * a quantity, and drawing it as a hairline next to a bar of forty people would read as a
 * catastrophic drop-off rather than as "SMTP is configured".
 */
export function stepBarPercent(dto: ActivationFunnelDto, count: number): number {
  const widest = Math.max(
    0,
    ...dto.steps.filter((step) => step.unit === 'users').map((step) => step.count),
  );
  if (widest === 0) return 0;
  return Math.min(100, (count / widest) * 100);
}
