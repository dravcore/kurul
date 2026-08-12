'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * "Are we past hydration?" as an external store rather than a mount effect.
 *
 * The value never changes after the first client render, so `subscribe` has nothing to
 * report and returns a no-op unsubscribe; it is module-level so the identity is stable and
 * React does not resubscribe on every render. The two snapshot functions are the whole
 * point: `getServerSnapshot` is what the server and the hydration pass read, so the markup
 * matches, and `getSnapshot` takes over on the client.
 */
const subscribeToNothing = (): (() => void) => () => {};
const getIsHydrated = (): boolean => true;
const getIsHydratedOnServer = (): boolean => false;

export function ThemeToggle(): React.ReactElement | null {
  const t = useTranslations('app.shell');
  const { resolvedTheme, setTheme } = useTheme();
  // `resolvedTheme` is undefined until next-themes has read the DOM, so rendering the button
  // before hydration would commit the wrong icon and label and then swap them.
  const hydrated = useSyncExternalStore(subscribeToNothing, getIsHydrated, getIsHydratedOnServer);

  if (!hydrated) {
    return null;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? t('themeLight') : t('themeDark')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
