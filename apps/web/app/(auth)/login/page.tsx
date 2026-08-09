'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { Button } from '@/components/ui/button';
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

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(t('error'));
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <AuthFormField
          label={t('email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthFormField
          label={t('password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-body text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </form>

      <p className="text-body text-muted-foreground">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-signature underline underline-offset-4">
          {t('registerLink')}
        </Link>
      </p>
    </>
  );
}
