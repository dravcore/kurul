import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ResetPasswordView } from '@/components/auth/reset-password-view';

/**
 * Landing page for a password-reset link.
 *
 * The token (or the failure) arrives as a search parameter, and reading one client-side needs
 * a Suspense boundary or the whole route opts out of static rendering.
 */
export default async function ResetPasswordPage(): Promise<React.ReactElement> {
  const t = await getTranslations('auth.resetPassword');

  return (
    <Suspense fallback={<p className="text-body text-muted-foreground">{t('loading')}</p>}>
      <ResetPasswordView />
    </Suspense>
  );
}
