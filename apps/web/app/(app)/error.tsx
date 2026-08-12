'use client';

import { RouteErrorState } from '@/components/layout/route-error-state';

/**
 * The boundary for every signed-in route.
 *
 * At the group rather than per route: it is nested inside `(app)/layout.tsx`, so a board that
 * throws keeps the sidebar, the workspace switcher and the notification bell, and the user
 * stays where they were. A copy under each of `board`, `dashboard`, `notifications` and
 * `settings` would render exactly this and only differ in the folder it lives in.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return <RouteErrorState error={error} reset={reset} homeHref="/dashboard" />;
}
