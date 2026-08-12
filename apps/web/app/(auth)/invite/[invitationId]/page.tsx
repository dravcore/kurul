import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { InviteAcceptView } from '@/components/auth/invite-accept-view';

/**
 * The invitation link's landing page.
 *
 * A failed confirmation link returns here carrying `?error=…` (see
 * `lib/email-verification.ts`), and reading a search parameter client-side needs a Suspense
 * boundary or the whole route opts out of static rendering.
 */
export default async function InviteAcceptPage({
  params,
}: Readonly<{ params: Promise<{ invitationId: string }> }>): Promise<React.ReactElement> {
  const { invitationId } = await params;
  const t = await getTranslations('auth.invite');

  return (
    <Suspense fallback={<p className="text-body text-muted-foreground">{t('loading')}</p>}>
      <InviteAcceptView invitationId={invitationId} />
    </Suspense>
  );
}
