'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { WorkspaceMemberDto } from '@kurultay/shared-types';
import { api } from '@/lib/api';
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

    const controller = new AbortController();

    void (async () => {
      const invitation = await authClient.organization.getInvitation({
        query: { id: invitationId },
      });
      if (controller.signal.aborted) {
        return;
      }
      if (invitation.data?.organizationId) {
        setWorkspaceId(invitation.data.organizationId);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [session, invitationId]);

  async function onAccept(): Promise<void> {
    if (!workspaceId || !invitationId) {
      setError(t('error'));
      return;
    }

    setPending(true);
    setError(null);

    try {
      await api.post<WorkspaceMemberDto>(
        `/workspaces/${workspaceId}/invitations/${invitationId}/accept`,
      );

      await authClient.organization.setActive({
        organizationId: workspaceId,
      });

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  if (isPending) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('loading')}</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t('signInFirst')}</p>
        <Link
          href={`/login?next=/invite/${invitationId}`}
          className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-center text-[var(--color-primary-foreground)]"
        >
          {t('signInCta')}
        </Link>
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
