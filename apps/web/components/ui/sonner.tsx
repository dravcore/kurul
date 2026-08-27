'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * The app's toast host.
 *
 * 4s and three at a time, per `docs/design.md` §5: long enough to read one line, short enough
 * that a burst of them clears itself, and a stack that cannot grow past the corner of the
 * screen. A toast carrying an action passes its own longer `duration` at the call site, since a
 * control nobody has time to reach is worse than no control.
 */
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps['theme']}
      position="bottom-right"
      duration={4000}
      visibleToasts={3}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
