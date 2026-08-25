'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { RESET_PASSWORD_PATH } from '@/components/auth/password-reset-paths';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';

/**
 * The "I forgot my password" form.
 *
 * The endpoint answers `200` for every address, registered or not, precisely so nobody can
 * enumerate accounts with it. The wording after a send therefore stays conditional ("if that
 * address has an account"), however unhelpful that reads to the person who does have one: the
 * alternative is a form that confirms which addresses exist to anyone who types them in.
 */
export function ForgotPasswordView(): React.ReactElement {
  const t = useTranslations('auth.forgotPassword');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        // The API resolves this path against `WEB_URL`, so the emailed link hands the token
        // to our own reset page rather than to the API's root.
        redirectTo: RESET_PASSWORD_PATH,
      });

      if (result.error) {
        setError(t('sendError'));
        return;
      }

      setSent(true);
    } catch {
      setError(t('sendError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <AuthFormField
          label={t('email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error ? <SubmitError message={error} /> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t('sending') : t('submit')}
        </Button>
        {/* Kept mounted rather than conditionally rendered: a live region a screen reader has
            not observed before the text arrives is not announced. */}
        <p className="text-body text-muted-foreground empty:hidden" role="status">
          {sent ? t('sent') : null}
        </p>
      </form>

      <p className="text-body text-muted-foreground">
        <Link href="/login" className="text-signature underline underline-offset-4">
          {t('backToLogin')}
        </Link>
      </p>
    </>
  );
}
