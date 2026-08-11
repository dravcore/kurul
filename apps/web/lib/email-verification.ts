import { ApiError, apiStatus } from './api';

/**
 * Email-confirmation rules shared by `/verify-email` and the invitation page.
 *
 * The contract lives in `docs/decisions/0013-invitation-email-verification.md`: signing in
 * never needs a confirmed address, accepting a workspace invitation always does.
 */

/** The page a confirmation link lands on when it was not started from somewhere specific. */
export const VERIFY_EMAIL_PATH = '/verify-email';

/**
 * Where a confirmation link should land when it was started from an invitation.
 *
 * Handed to Better Auth as `callbackURL`. The API resolves a leading-slash path against
 * `WEB_URL` (`apps/api/src/auth/web-urls.ts`), so the invitee comes back to the invitation
 * they were in the middle of accepting instead of a generic confirmation page — without it,
 * confirming an address means losing the invitation link that asked for it.
 */
export function inviteCallbackPath(invitationId: string): string {
  return `/invite/${invitationId}`;
}

/** Failure codes Better Auth redirects a confirmation link back with. */
const LINK_ERROR_CODES = ['TOKEN_EXPIRED', 'INVALID_TOKEN', 'USER_NOT_FOUND'] as const;

export type VerificationLinkError = (typeof LINK_ERROR_CODES)[number] | 'unknown';

/**
 * Reads the outcome of a confirmation link off the URL it landed on.
 *
 * Better Auth appends `?error=<CODE>` when the link failed and adds nothing at all when it
 * worked, so the absence of the parameter *is* the success signal — there is no positive
 * marker to wait for. `null` therefore means confirmed.
 *
 * An unrecognised code still has to say something useful, so it collapses to `unknown`
 * rather than being treated as success.
 */
export function verificationLinkError(code: string | null): VerificationLinkError | null {
  if (code === null || code === '') {
    return null;
  }
  return LINK_ERROR_CODES.find((known) => known === code) ?? 'unknown';
}

/**
 * The 403s Better Auth's own `get-invitation` route can answer with.
 *
 * Listed in full on purpose: knowing the *complete* set is what lets the code below trust a
 * recognised code and stop guessing.
 */
const INVITATION_FORBIDDEN_CODES = new Set([
  'EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION',
  'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
]);

const VERIFICATION_REQUIRED_CODE = 'EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION';

/**
 * Whether a refused invitation request was refused because the caller's address is unconfirmed.
 *
 * Two different origins answer 403 on this flow and they carry different amounts of detail:
 *
 * - `authClient.organization.getInvitation` talks to Better Auth directly and returns its own
 *   code, which names the reason exactly. When the code is one Better Auth is known to send,
 *   it is the answer — including when it says the caller is simply not the invitee.
 * - `POST /workspaces/:id/invitations/:invitationId/accept` goes through Nest, whose error
 *   body carries only a reason phrase (`"Forbidden"`) and an English sentence. Branching on
 *   that sentence is forbidden (`docs/design.md` §6) and would break the moment the API is
 *   translated or the wording is edited, so the decision falls back to the two facts that are
 *   structured: the status, and what the session says about this account. A 403 here with an
 *   unconfirmed address is the case this feature exists for.
 */
export function isEmailVerificationRequired(
  caught: unknown,
  emailVerified: boolean | undefined,
): boolean {
  if (apiStatus(caught) !== 403) {
    return false;
  }

  const code = caught instanceof ApiError ? caught.body.error : null;
  if (code !== null && INVITATION_FORBIDDEN_CODES.has(code)) {
    return code === VERIFICATION_REQUIRED_CODE;
  }

  return emailVerified === false;
}
