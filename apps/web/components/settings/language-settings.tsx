'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
  type UpdateMeRequest,
  type UserDto,
} from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, resolveApiMessage } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { writeLocaleCookie } from '@/lib/locale-cookie';

/**
 * The value standing for "no stored preference".
 *
 * A `<select>` option value is always a string, and the empty string is the one value no IETF
 * tag can collide with. `null` on the wire is a real choice — it puts the user back on their
 * browser's `Accept-Language` — so it needs a representation here rather than being folded
 * into English.
 */
const FOLLOW_BROWSER = '';

export function LanguageSettings(): React.ReactElement {
  const t = useTranslations('app.settings.language');
  const tErrors = useTranslations('app.errors');
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const fetchMe = useCallback((signal: AbortSignal) => api.get<UserDto>('/me', { signal }), []);
  const {
    data: user,
    loading,
    error,
    reload,
  } = useApiResource<UserDto | null>(fetchMe, null, t('loadError'));

  const onChange = useCallback(
    async (value: string): Promise<void> => {
      const locale: Locale | null = isLocale(value) ? value : null;
      setSaving(true);
      try {
        const body: UpdateMeRequest = { locale };
        await api.patch<UserDto, UpdateMeRequest>('/me', body);

        // Cookie *and* database, in that order of importance to this render: the cookie is
        // what the very next server render reads without waiting on `/me`, and the database
        // is what outbound email and the user's other devices read.
        writeLocaleCookie(locale);

        // The catalog is chosen during the server render, so the new language only appears
        // once the tree is re-rendered.
        router.refresh();
        toast.success(t('saved'));
      } catch (caught) {
        toast.error(
          resolveApiMessage(caught, t, {
            fallback: 'saveError',
            byStatus: { 401: 'saveErrorSignedOut' },
          }),
        );
      } finally {
        setSaving(false);
      }
    },
    [router, t],
  );

  if (loading) {
    return <Skeleton className="h-9 w-full max-w-xs" />;
  }

  if (error !== null || !user) {
    // Unexplained, so the recovery is a control rather than a sentence (docs/design.md §7).
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-destructive">{error ?? t('loadError')}</p>
        <Button type="button" onClick={reload}>
          {tErrors('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="language">{t('label')}</Label>
      <Select
        id="language"
        className="max-w-xs"
        value={user.locale ?? FOLLOW_BROWSER}
        disabled={saving}
        onChange={(event) => void onChange(event.target.value)}
      >
        <option value={FOLLOW_BROWSER}>{t('followBrowser')}</option>
        {SUPPORTED_LOCALES.map((locale) => (
          // Named from the catalog rather than from `Intl.DisplayNames`: the list is short,
          // and a translator gets to decide whether their language reads better as an endonym
          // than as a translation.
          <option key={locale} value={locale}>
            {t(`options.${locale}`)}
          </option>
        ))}
      </Select>
      <p className="text-caption text-muted-foreground">{t('help')}</p>
    </div>
  );
}
