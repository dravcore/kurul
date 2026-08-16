import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE_NAME } from '@kurul/shared-types';
import { resolveRequestLocale } from './user-locale';

/**
 * Resolves the interface language for every server render.
 *
 * No `[locale]` path segment and no i18n middleware — see `resolveRequestLocale` and
 * ADR 0018. `apps/web/middleware.ts` matches routes literally (`/login`, `/invite/…`,
 * `pathname === '/'`), and a language prefix would invalidate every one of those comparisons
 * at once, on the one file where a mistake signs users out.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const locale = await resolveRequestLocale({
    cookieHeader: headerList.get('cookie'),
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null,
    acceptLanguage: headerList.get('accept-language'),
  });

  return {
    locale,
    // Safe as a template: `locale` is always a member of `SUPPORTED_LOCALES`, never a raw
    // cookie or header value.
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
