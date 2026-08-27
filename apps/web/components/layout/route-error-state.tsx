'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface RouteErrorStateProps {
  /** What the boundary caught. Logged, never rendered — see below. */
  error: Error & { digest?: string };
  /** Re-renders the segment that threw. Next's own retry, wired to a real control. */
  reset: () => void;
  /**
   * Where "somewhere that still works" is, when there is such a place. The root boundary also
   * covers the signed-out routes, where the dashboard is not a way out.
   */
  homeHref?: string;
}

/**
 * What an `error.tsx` boundary renders.
 *
 * Shared by the boundaries rather than written twice: the copy and the visual language are the
 * same wherever a segment throws, and only the way out differs. Keeping it in one component is
 * also what keeps the strings in one place in the catalogue.
 */
export function RouteErrorState({
  error,
  reset,
  homeHref,
}: RouteErrorStateProps): React.ReactElement {
  const t = useTranslations('app.errors');

  useEffect(() => {
    // Logged rather than shown. `docs/design.md` §6 keeps ids and stack traces off the screen,
    // and the digest is the only thread from what the user saw back to the server log.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <h1 className="text-title-lg text-destructive">{t('pageTitle')}</h1>
      <p className="max-w-md text-body text-muted-foreground">{t('pageBody')}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={reset}>
          {t('retry')}
        </Button>
        {homeHref ? (
          <Button asChild variant="outline">
            <Link href={homeHref}>{t('backHome')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
