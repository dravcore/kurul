import type { Metadata } from 'next';
import { Archivo, Fraunces, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { CSP_NONCE_HEADER } from '@/lib/security-headers';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-archivo',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-fraunces',
  display: 'swap',
  // Without this axis next/font/google embeds only the low-optical-size cut, so a 40px
  // `display` heading renders with 14pt strokes instead of the carved 40pt cut docs/design.md
  // §3 describes; `.text-display` in globals.css dials the instance to that cut at runtime.
  axes: ['opsz'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-jetbrains',
  display: 'swap',
});

// The tab title and share description are user-visible copy, so they come from the catalogue
// like every other string (ADR 0018). That makes this `generateMetadata` rather than a static
// `metadata` export: the locale is only known per request.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app.meta');
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.ReactElement> {
  const locale = await getLocale();
  const messages = await getMessages();
  // `next-themes` writes an inline `<script>` into `<head>` that applies the stored theme
  // class before first paint. Next nonces the scripts *it* emits by itself, but it has no way
  // to know about this one, so the nonce `proxy.ts` minted is handed over explicitly. Without
  // it the script is blocked, the page paints in the wrong theme, and React fails hydration
  // over the `<html>` class that never arrived (minified error #412).
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${archivo.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider nonce={nonce}>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
