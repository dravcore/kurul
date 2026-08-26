/**
 * The two web routes of the password-reset flow, spelled once.
 *
 * `RESET_PASSWORD_PATH` is also what the API defaults to when a client asks for a reset without
 * naming a `redirectTo` (`apps/api/src/auth/web-urls.ts`); the forgot-password form passes it
 * explicitly anyway, so the link in the email and the page that reads it cannot drift apart.
 */
export const FORGOT_PASSWORD_PATH = '/forgot-password';
export const RESET_PASSWORD_PATH = '/reset-password';
