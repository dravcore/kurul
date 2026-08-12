import type { Metadata } from 'next';
import { Archivo, Fraunces, JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { Toaster } from '@/components/ui/sonner';
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

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${archivo.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
