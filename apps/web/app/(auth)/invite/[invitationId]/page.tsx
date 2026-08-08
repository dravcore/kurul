'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { authClient } from '@/lib/auth';

export default function InviteAcceptPage(): React.ReactElement {
  const t = useTranslations('auth.invite');
  const params = useParams<{ invitationId: string }>();
  const router = useRouter();
  const invitationId = params.invitationId;
  const { data: session, isPending } = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !invitationId) {
      return;
    }

    void (async () => {
      // Better Auth getInvitation returns organization id; map via our list if needed.
      const invitation = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (invitation.data?.organizationId) {
        setWorkspaceId(invitation.data.organizationId);
      }
    })();
  }, [session, invitationId]);

  async function onAccept(): Promise<void> {
    if (!workspaceId || !invitationId) {
      setError(t('error'));
      return;
    }

    setPending(true);
    setError(null);

    const response = await apiFetch(
      `/workspaces/${workspaceId}/invitations/${invitationId}/accept`,
      { method: 'POST' },
    );

    setPending(false);

    if (!response.ok) {
      setError(t('error'));
      return;
    }

    await authClient.organization.setActive({
      organizationId: workspaceId,
    });

    router.replace('/dashboard');
    router.refresh();
  }

  if (isPending) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <p className="text-sm text-[var(--color-muted-foreground)]">…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('signInFirst')}</p>
        <a
          href={`/login`}
          className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-center text-[var(--color-primary-foreground)]"
        >
          Sign in
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t('subtitle')}</p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !workspaceId}
        onClick={() => void onAccept()}
        className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-[var(--color-primary-foreground)] disabled:opacity-60"
      >
        {t('submit')}
      </button>
    </main>
  );
}
