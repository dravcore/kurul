import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { RegisterView } from '@/components/auth/register-view';

/**
 * The sign-up page.
 *
 * The form reads where the visitor was heading from `?next=…`, and reading a search parameter
 * client-side needs a Suspense boundary or the whole route opts out of static rendering.
 */
export default async function RegisterPage(): Promise<React.ReactElement> {
  const t = await getTranslations('auth.register');

  return (
    <Suspense fallback={<p className="text-body text-muted-foreground">{t('loading')}</p>}>
      <RegisterView />
    </Suspense>
  );
}
