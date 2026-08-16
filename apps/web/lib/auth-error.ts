/**
 * Better Auth sign-up error code → field name and i18n message key mapping.
 *
 * When `authClient.signUp.email()` fails, it returns an error code in `error.code` — for
 * example, `PASSWORD_TOO_SHORT` — that maps to a specific field and an i18n message key
 * unique to that code. The RegisterView uses this to show field-level error messages under
 * the relevant input, instead of a single generic "could not create your account" message.
 *
 * The codes are sourced from Better Auth v1.6.26's sign-up endpoint:
 * `apps/web/node_modules/better-auth/dist/api/routes/sign-up.mjs`.
 *
 * Field assignment decisions:
 * - Email-related codes → email field: `INVALID_EMAIL`, `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`
 * - Password-related codes → password field: `INVALID_PASSWORD`, `PASSWORD_TOO_SHORT`,
 *   `PASSWORD_TOO_LONG`
 * - Unknown or unrelated codes → generic error (shown as fallback, not under a field)
 *
 * The message key follows the pattern `auth.register.fieldErrors.<field>.<code>`, where the
 * caller resolves it through next-intl. If a code is unknown, the caller falls back to the
 * generic `auth.register.error` message.
 */
export interface RegisterFieldErrorMapping {
  /**
   * The field this code applies to, or `null` for a generic error (not tied to a field).
   * When non-null, the caller shows the error under the field's input.
   */
  field: 'email' | 'password' | null;
  /**
   * The i18n message key to resolve for this code.
   * Example: for code `PASSWORD_TOO_SHORT`, this is `fieldErrors.password.passwordTooShort`.
   * The caller constructs the full key: `auth.register.<messageKey>`.
   */
  messageKey: string;
}

/**
 * Maps a Better Auth sign-up error code to a field and i18n message key.
 *
 * Returns `null` when the code is unknown; the caller should fall back to the generic
 * `auth.register.error` message.
 *
 * @param code Better Auth error code (e.g., `PASSWORD_TOO_SHORT`)
 */
export function resolveRegisterErrorMapping(
  code: string | undefined,
): RegisterFieldErrorMapping | null {
  if (!code) {
    return null;
  }

  switch (code) {
    // Email validation errors.
    case 'INVALID_EMAIL':
      return {
        field: 'email',
        messageKey: 'fieldErrors.email.invalidEmail',
      };

    // Email already in use — user should retry with a different address.
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return {
        field: 'email',
        messageKey: 'fieldErrors.email.alreadyExists',
      };

    // Password validation errors.
    case 'INVALID_PASSWORD':
      return {
        field: 'password',
        messageKey: 'fieldErrors.password.invalidPassword',
      };

    case 'PASSWORD_TOO_SHORT':
      return {
        field: 'password',
        messageKey: 'fieldErrors.password.tooShort',
      };

    case 'PASSWORD_TOO_LONG':
      return {
        field: 'password',
        messageKey: 'fieldErrors.password.tooLong',
      };

    // Unrecognized code — fall back to generic message.
    default:
      return null;
  }
}
