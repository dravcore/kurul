import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

/**
 * The 404 for a URL no route matched, and for any `notFound()` raised without a closer
 * boundary. One at the root is enough: nothing below it can say more about a page that does
 * not exist, and a per-segment copy would only repeat this one.
 *
 * No damga mark — `docs/design.md` §6 reserves those for empty states, which are invitations.
 * A dead link is not an invitation.
 */
export default async function NotFound(): Promise<React.ReactElement> {
  const t = await getTranslations('app.errors');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="font-display text-title-lg">{t('notFoundTitle')}</h1>
      <p className="max-w-md text-body text-muted-foreground">{t('notFoundBody')}</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">{t('backHome')}</Link>
      </Button>
    </div>
  );
}
