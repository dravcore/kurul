import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { VerifyEmailView } from '@/components/auth/verify-email-view';

/**
 * Landing page for a confirmation link.
 *
 * The outcome arrives as a search parameter, and reading one client-side needs a Suspense
 * boundary or the whole route opts out of static rendering.
 */
export default async function VerifyEmailPage(): Promise<React.ReactElement> {
  const t = await getTranslations('auth.verifyEmail');

  return (
    <Suspense fallback={<p className="text-body text-muted-foreground">{t('loading')}</p>}>
      <VerifyEmailView />
    </Suspense>
  );
}
