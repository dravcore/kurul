'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth';

export default function LoginPage(): React.ReactElement {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await authClient.signIn.email({
      email,
      password,
    });

    setPending(false);

    if (result.error) {
      setError(t('error'));
      return;
    }

    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('subtitle')}</p>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('email')}</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('password')}</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-[var(--color-primary-foreground)] disabled:opacity-60"
        >
          {t('submit')}
        </button>
      </form>

      <p className="text-sm text-[var(--color-muted-foreground)]">
        {t('noAccount')}{' '}
        <Link href="/register" className="underline">
          {t('registerLink')}
        </Link>
      </p>
    </main>
  );
}
