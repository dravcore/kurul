'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { FORGOT_PASSWORD_PATH } from '@/components/auth/password-reset-paths';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';

/** Better Auth's code for a token that is unknown, already used, or past its hour. */
const INVALID_TOKEN_CODE = 'INVALID_TOKEN';

/**
 * Better Auth's rate limiter answers with a bare `429` and no error code of its own, so this is
 * the one refusal here that is read off the status rather than off `error.code`. It matters
 * because the generic message tells the reader to send themselves a new link, which is the
 * worst possible advice while a limiter is counting.
 */
const TOO_MANY_REQUESTS = 429;

/**
 * Reset-form error codes that belong under the password field, and the message each maps to.
 *
 * Branching on the machine-readable code, never the English sentence beside it
 * (docs/design.md §6). Anything not listed here and not `INVALID_TOKEN` is shown as the
 * generic failure above the form.
 */
const PASSWORD_FIELD_ERRORS: Record<string, string> = {
  PASSWORD_TOO_SHORT: 'fieldErrors.password.tooShort',
  PASSWORD_TOO_LONG: 'fieldErrors.password.tooLong',
};

/**
 * Where the emailed reset link lands, and where the new password is chosen.
 *
 * The API has already checked the token once by the time this renders: the link in the email
 * points at `/auth/reset-password/<token>`, which redirects here with `?token=` when the token
 * is good and `?error=INVALID_TOKEN` when it is not. The token is checked a second time when
 * the form is submitted, because it can expire, or be used from another tab, in between.
 */
export function ResetPasswordView(): React.ReactElement {
  const t = useTranslations('auth.resetPassword');
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [linkRejected, setLinkRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const token = searchParams.get('token');
  const linkUnusable =
    token === null || token === '' || searchParams.get('error') !== null || linkRejected;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (token === null) {
      return;
    }
    setPending(true);
    setError(null);
    setFieldError(null);

    try {
      const result = await authClient.resetPassword({ newPassword: password, token });

      if (result.error) {
        const code = result.error.code;
        if (code === INVALID_TOKEN_CODE) {
          setLinkRejected(true);
        } else if (code !== undefined && code in PASSWORD_FIELD_ERRORS) {
          setFieldError(t(PASSWORD_FIELD_ERRORS[code]!));
        } else if (result.error.status === TOO_MANY_REQUESTS) {
          setError(t('rateLimited'));
        } else {
          setError(t('error'));
        }
        return;
      }

      setDone(true);
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display tracking-tight">{t('successTitle')}</h1>
          <p className="text-body text-muted-foreground">{t('successBody')}</p>
        </div>
        <Button asChild>
          <Link href="/login">{t('signInCta')}</Link>
        </Button>
      </>
    );
  }

  if (linkUnusable) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display tracking-tight">{t('invalidTitle')}</h1>
          <p className="text-body text-destructive">{t('invalidBody')}</p>
        </div>
        <Button asChild>
          <Link href={FORGOT_PASSWORD_PATH}>{t('requestNewLink')}</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <AuthFormField
          label={t('newPassword')}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldError}
        />
        {error ? <SubmitError message={error} /> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </>
  );
}
