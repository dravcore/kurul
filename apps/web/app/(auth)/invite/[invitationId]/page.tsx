'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { WorkspaceMemberDto } from '@kurultay/shared-types';
import { Button } from '@/components/ui/button';
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
    return <p className="text-body text-muted-foreground">{t('loading')}</p>;
  }

  if (!session) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('signInFirst')}</p>
        </div>
        <Button asChild>
          <Link href={`/login?next=/invite/${invitationId}`}>{t('signInCta')}</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error ? <p className="text-body text-destructive">{error}</p> : null}
      <Button type="button" disabled={pending || !workspaceId} onClick={() => void onAccept()}>
        {t('submit')}
      </Button>
    </>
  );
}
