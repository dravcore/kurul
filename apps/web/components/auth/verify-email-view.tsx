'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { VerificationResend } from '@/components/auth/verification-resend';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth';
import { VERIFY_EMAIL_PATH, verificationLinkError } from '@/lib/email-verification';

/**
 * Where a confirmation link lands.
 *
 * Nothing is verified here — the API already did that before redirecting. The page only reads
 * the outcome off the URL and gives the visitor the next move.
 */
export function VerifyEmailView(): React.ReactElement {
  const t = useTranslations('auth.verifyEmail');
  const tv = useTranslations('auth.verification');
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const linkError = verificationLinkError(searchParams.get('error'));

  // A confirmed session outranks a failed link: someone who verified in another tab, or who
  // reopened the older of two links, is done and should be told so rather than sent to fix
  // something that is no longer broken.
  const confirmed = linkError === null || session?.user.emailVerified === true;

  if (confirmed) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display tracking-tight">{t('successTitle')}</h1>
          <p className="text-body text-muted-foreground">{t('successBody')}</p>
        </div>
        {/* `autoSignInAfterVerification` usually leaves a session behind, but a link opened in
            another browser has none — which of the two CTAs applies is not known until the
            session settles, so the button waits rather than flipping under the pointer. */}
        {isPending ? (
          <Skeleton className="h-9 w-44" />
        ) : (
          <Button asChild>
            <Link href={session ? '/dashboard' : '/login'}>
              {session ? t('continue') : t('signInCta')}
            </Link>
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('failedTitle')}</h1>
        <p className="text-body text-destructive">{tv(`linkErrors.${linkError}`)}</p>
      </div>

      {isPending ? (
        <Skeleton className="h-9 w-44" />
      ) : (
        <VerificationResend email={session?.user.email ?? null} callbackPath={VERIFY_EMAIL_PATH} />
      )}

      {linkError === 'USER_NOT_FOUND' && !session ? (
        <p className="text-body text-muted-foreground">
          {t('noAccount')}{' '}
          <Link href="/register" className="text-signature underline underline-offset-4">
            {t('registerLink')}
          </Link>
        </p>
      ) : null}
    </>
  );
}
