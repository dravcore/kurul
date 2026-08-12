'use client';

import { RouteErrorState } from '@/components/layout/route-error-state';

/**
 * The last boundary before Next's own bare error screen.
 *
 * It sits outside every route group, so it is what catches a throw in the signed-out routes
 * too — and there "back to your boards" is not a way out, which is why it offers only the
 * retry. Errors thrown by the root layout itself are still Next's to render: a `global-error`
 * boundary replaces `app/layout.tsx`, and with it the `NextIntlClientProvider` every string in
 * this app is read through.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return <RouteErrorState error={error} reset={reset} />;
}
