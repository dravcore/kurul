'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import type { WorkspaceDto } from '@kurultay/shared-types';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function NewWorkspacePage(): React.ReactElement {
  const t = useTranslations('app.workspace');
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const workspace = await api.post<WorkspaceDto>('/workspaces', { name, slug });
      await authClient.organization.setActive({
        organizationId: workspace.id,
      });

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h1 className="text-title-lg tracking-tight">{t('createTitle')}</h1>
      <p className="text-body text-muted-foreground">{t('createSubtitle')}</p>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <AuthFormField
          label={t('name')}
          value={name}
          onChange={(e) => {
            const next = e.target.value;
            setName(next);
            if (!slugTouched) {
              setSlug(slugify(next));
            }
          }}
        />
        <AuthFormField
          label={t('slug')}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
        {error ? <p className="text-body text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </form>
    </div>
  );
}
