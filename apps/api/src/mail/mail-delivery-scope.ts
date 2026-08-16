import { AsyncLocalStorage } from 'node:async_hooks';
import { MailDeliveryStatus } from '@kurul/shared-types';

/**
 * The return channel for a send that has no return channel.
 *
 * ## Why this exists
 *
 * `POST /workspaces/:workspaceId/invitations` does not send the invitation email. Better Auth
 * does, from its own `sendInvitationEmail` hook (`auth/organization-options.ts`), which the
 * plugin calls somewhere inside `auth.api.createInvitation` and whose return value it
 * discards. So the one frame that knows the email went nowhere — `sendWith`, which swallows
 * delivery failures by design — has no way to hand that fact back to the frame that owes the
 * admin an answer. That gap is the finding: the invitation is stored, `201` is returned, the
 * log records "no SMTP", and the admin is told nothing.
 *
 * ## Why `AsyncLocalStorage` and not a module-level variable
 *
 * A plain "last delivery" slot is correct exactly until two invitations are in flight at once,
 * which on a single-threaded event loop is any two overlapping requests: both open the slot,
 * both hooks write to it, and one admin is shown the other's outcome. Keying a map by
 * invitation id would work, but the id is only known *after* the call returns, so the map
 * would have to be written by the hook and swept by something else — an unbounded structure
 * with no natural owner. `AsyncLocalStorage` follows the await chain the plugin already runs
 * on, so the outcome lands in the caller that started it and nowhere else, and the storage is
 * released with the frame.
 *
 * ## What it deliberately does not do
 *
 * It does not make delivery a precondition of anything. `sendWith` still swallows, the
 * invitation is still created, and the request still succeeds — this only ensures the
 * response can *say* what happened. See `docs/decisions/0013-invitation-email-verification.md`
 * for why an undeliverable invitation is a supported (if useless) state rather than an error.
 */
interface DeliverySlot {
  /** `undefined` until a send happens inside the scope — see `captureMailDelivery`. */
  status: MailDeliveryStatus | undefined;
}

const storage = new AsyncLocalStorage<DeliverySlot>();

/**
 * Records the outcome of one send into the enclosing `captureMailDelivery`, if there is one.
 *
 * A no-op outside a scope, which is the common case: verification emails, and every future
 * notification email, are sent from requests that have nothing to report about them.
 *
 * **A non-`SENT` status is never overwritten.** If a scope somehow covers two sends, what the
 * admin needs to know is that one of them did not go out; letting a later success bury an
 * earlier failure would restore precisely the silence this module removes.
 */
export function recordMailDelivery(status: MailDeliveryStatus): void {
  const slot = storage.getStore();
  if (slot === undefined) {
    return;
  }

  if (slot.status === undefined || slot.status === MailDeliveryStatus.SENT) {
    slot.status = status;
  }
}

/**
 * Runs `operation` with a slot that any `sendMail` beneath it reports into.
 *
 * `delivery` is `undefined` when no send was observed. That is not "it worked": it means this
 * process never saw a message go out for this operation — the third-party hook may not have
 * been reached, or it dispatched off the await chain — and the caller must pass that ignorance
 * on rather than resolve it into a verdict. `InvitationDto.emailDelivery` is optional for
 * exactly this reason.
 */
export async function captureMailDelivery<T>(
  operation: () => Promise<T>,
): Promise<{ result: T; delivery: MailDeliveryStatus | undefined }> {
  const slot: DeliverySlot = { status: undefined };
  const result = await storage.run(slot, operation);

  return { result, delivery: slot.status };
}
