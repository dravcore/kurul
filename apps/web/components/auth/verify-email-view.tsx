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
 * Marks a visit that did *not* come from a link — someone who arrived to ask for one.
 *
 * Better Auth never appends this parameter, so a real link landing is unchanged: `?error=…`
 * when it failed, nothing at all when it worked. Without the flag, the bare URL has to mean
 * "confirmed", because the absence of `?error=` is the only success signal there is.
 */
const RESEND_PARAM = 'resend';

/** Where to send someone who wants a confirmation link rather than one who just used one. */
export const VERIFY_EMAIL_RESEND_PATH = `${VERIFY_EMAIL_PATH}?${RESEND_PARAM}=1`;

/**
 * Where a confirmation link lands, and where someone who needs a new one comes to ask.
 *
 * Nothing is verified here — the API already did that before redirecting. The page reads the
 * outcome off the URL and gives the visitor the next move; when there is no outcome to read
 * because they came from the sidebar (`EmailVerificationLink`), the next move is the only
 * thing it shows.
 */
export function VerifyEmailView(): React.ReactElement {
  const t = useTranslations('auth.verifyEmail');
  const tv = useTranslations('auth.verification');
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const linkError = verificationLinkError(searchParams.get('error'));
  const requested = searchParams.get(RESEND_PARAM) !== null;

  // A confirmed session outranks everything else: someone who verified in another tab, who
  // reopened the older of two links, or who clicked the sidebar entry twice is done and should
  // be told so rather than sent to fix something that is no longer broken. Otherwise a bare
  // URL still means success — unless the visitor said, via the flag, that they came to ask.
  const confirmed = session?.user.emailVerified === true || (!requested && linkError === null);

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
        <h1 className="font-display text-display tracking-tight">
          {linkError === null ? t('pendingTitle') : t('failedTitle')}
        </h1>
        {linkError === null ? (
          // Says what confirming is *for* and what it does not gate, so the errand reads as
          // optional housekeeping rather than something broken (docs/design.md §7).
          <p className="text-body text-muted-foreground">{t('pendingBody')}</p>
        ) : (
          <p className="text-body text-destructive">{tv(`linkErrors.${linkError}`)}</p>
        )}
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

      {/* This route lives outside the app shell, so someone who walked in from the sidebar
          would otherwise have no way back but the browser's own button. Ghost, because the
          resend control is the one primary action on the screen (docs/design.md §2). */}
      {!isPending && session ? (
        <Button asChild variant="ghost" className="self-start">
          <Link href="/dashboard">{t('back')}</Link>
        </Button>
      ) : null}
    </>
  );
}
