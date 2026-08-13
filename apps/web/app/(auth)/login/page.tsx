import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LoginView } from '@/components/auth/login-view';

/**
 * The sign-in page.
 *
 * The form reads where the visitor was heading from `?next=…`, and reading a search parameter
 * client-side needs a Suspense boundary or the whole route opts out of static rendering.
 */
export default async function LoginPage(): Promise<React.ReactElement> {
  const t = await getTranslations('auth.login');

  return (
    <Suspense fallback={<p className="text-body text-muted-foreground">{t('loading')}</p>}>
      <LoginView />
    </Suspense>
  );
}
