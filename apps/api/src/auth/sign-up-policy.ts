import { envBool } from '../common/env';

/**
 * The switch that closes registration on an instance.
 *
 * `PLAN_MAX_USERS` is a head count and was, until this, the only way to stop strangers
 * registering on an internet-facing install: pin the number at the current population. That
 * blocks the operator's own invitees along with everyone else, and drifts the moment an account
 * is deleted. A policy needs a boolean, and this is it.
 *
 * Deliberately a single on/off switch. An invite-only mode (accept the sign-up when a pending
 * invitation names the address) cannot be decided where this is read: the Better Auth mount
 * runs ahead of the body parsers and never sees the sign-up email, so that mode has to live in
 * a `databaseHooks.user.create.before` hook, with the envelope trade `mount-better-auth.ts`
 * describes. It is a follow-up, not a second value of this variable.
 *
 * Independent of `DEMO_MODE` on purpose: the demo host keeps registration open (a demo nobody
 * can sign up to is a demo of a login screen), an ordinary install may close it, and neither
 * switch reads the other.
 */
export const SIGNUP_ENABLED_ENV = 'SIGNUP_ENABLED';

/**
 * Whether `POST /auth/sign-up/email` may create an account. Unset is open, which is what every
 * install ran before the switch existed.
 *
 * Read per call rather than cached at boot, matching `demoModeEnabled()`: the paths that ask are
 * not hot, a restart is the only way to change the variable either way, and reading live is what
 * lets a test flip it around a single request instead of rebuilding the Nest container.
 */
export function signUpEnabled(): boolean {
  return envBool(SIGNUP_ENABLED_ENV, true);
}
