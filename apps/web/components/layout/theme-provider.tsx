'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * `nonce` is forwarded to the inline `<script>` `next-themes` puts in `<head>` to set the
 * theme class before first paint. It is optional only because a jsdom test renders this
 * without a request behind it; in the app it always arrives (`app/layout.tsx`), and the
 * script does not run without it — `script-src` carries no `'unsafe-inline'`.
 */
export function ThemeProvider({
  children,
  nonce,
}: Readonly<{
  children: React.ReactNode;
  nonce?: string;
}>): React.ReactElement {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
