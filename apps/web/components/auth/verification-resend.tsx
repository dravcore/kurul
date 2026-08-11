'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';

/** Better Auth's code for "that address is already confirmed", answered with a 400. */
const ALREADY_VERIFIED_CODE = 'EMAIL_ALREADY_VERIFIED';

interface VerificationResendProps {
  /**
   * The signed-in caller's address, or `null` when nobody is signed in — a confirmation link
   * has to be addressed to someone, and a signed-out visitor is the only one who has to say
   * who that is.
   */
  email: string | null;
  /** Web path the new link returns to once the address is confirmed. */
  callbackPath: string;
}

/**
 * The "send me another confirmation link" control.
 *
 * Shared by the confirmation page and the invitation page so the two never drift on what the
 * endpoint is allowed to reveal: signed out, it answers `{ status: true }` for every address,
 * registered or not, precisely so nobody can enumerate accounts with it — which means the
 * wording here has to stay conditional in that case, however unhelpful that reads.
 */
export function VerificationResend({
  email,
  callbackPath,
}: Readonly<VerificationResendProps>): React.ReactElement {
  const t = useTranslations('auth.verification');
  const [typedEmail, setTypedEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(target: string): Promise<void> {
    setPending(true);
    setMessage(null);

    try {
      const result = await authClient.sendVerificationEmail({
        email: target,
        callbackURL: callbackPath,
      });

      if (result.error) {
        // Branch on the machine-readable code, never the English sentence beside it
        // (docs/design.md §6).
        setMessage(
          result.error.code === ALREADY_VERIFIED_CODE ? t('alreadyConfirmed') : t('sendError'),
        );
        return;
      }

      setMessage(email === null ? t('sentIfRegistered') : t('sentTo', { email: target }));
    } catch {
      setMessage(t('sendError'));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void send(typedEmail.trim());
  }

  return (
    <div className="flex flex-col gap-3">
      {email === null ? (
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <AuthFormField
            label={t('emailLabel')}
            type="email"
            autoComplete="email"
            value={typedEmail}
            onChange={(event) => setTypedEmail(event.target.value)}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('sending') : t('resendAction')}
          </Button>
        </form>
      ) : (
        <Button type="button" disabled={pending} onClick={() => void send(email)}>
          {pending ? t('sending') : t('resendAction')}
        </Button>
      )}
      {/* Kept mounted rather than conditionally rendered: a live region a screen reader has
          not observed before the text arrives is not announced. */}
      <p className="text-body text-muted-foreground empty:hidden" role="status">
        {message}
      </p>
    </div>
  );
}
