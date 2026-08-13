'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { WorkspaceMemberDto } from '@kurultay/shared-types';
import { VerificationResend } from '@/components/auth/verification-resend';
import { Button } from '@/components/ui/button';
import { api, authClientError, resolveApiMessage } from '@/lib/api';
import { withNextParam } from '@/lib/auth-redirect';
import { authClient } from '@/lib/auth';
import {
  inviteCallbackPath,
  isEmailVerificationRequired,
  verificationLinkError,
} from '@/lib/email-verification';
import { useApiResource } from '@/lib/use-api-resource';

interface Invitation {
  workspaceId: string;
  workspaceName: string;
}

/**
 * The invitation an invitee opens from their email.
 *
 * Since `requireEmailVerificationOnInvitation` was turned on (ADR 0013) an unconfirmed
 * account is refused at *both* ends of this screen — reading the invitation and accepting it
 * — so the screen has to be able to explain that and offer the way out, rather than showing
 * a dead "Accept" button or a generic failure.
 */
export function InviteAcceptView({
  invitationId,
}: Readonly<{ invitationId: string }>): React.ReactElement {
  const t = useTranslations('auth.invite');
  const tv = useTranslations('auth.emailConfirmation');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const emailVerified = session?.user.emailVerified;
  // A confirmation link that failed sends the invitee back *here*, because this page is the
  // `callbackURL` it was created with — so this screen owns that failure too.
  const linkError = verificationLinkError(searchParams.get('error'));

  const [verificationRequired, setVerificationRequired] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  /**
   * Whether the confirm-first screen we are about to render was reached by *this user's*
   * accept attempt, rather than by the load path that renders it on arrival.
   *
   * A ref and not state: it is never read while rendering and changing it must never cause a
   * render — the render that matters is the one `setVerificationRequired` already schedules,
   * and this only tells the effect running after it whether to move focus.
   */
  const moveFocusToVerifyRef = useRef(false);
  const verifyHeadingRef = useRef<HTMLHeadingElement>(null);

  const fetchInvitation = useCallback(async (): Promise<Invitation> => {
    const result = await authClient.organization.getInvitation({ query: { id: invitationId } });
    if (result.error) {
      throw authClientError(result.error);
    }
    return {
      workspaceId: result.data.organizationId,
      workspaceName: result.data.organizationName,
    };
  }, [invitationId]);

  const {
    data: invitation,
    loading,
    error: loadError,
  } = useApiResource<Invitation | null>(session ? fetchInvitation : null, null, t('loadError'), {
    onError: (caught) => {
      if (isEmailVerificationRequired(caught, emailVerified)) {
        setVerificationRequired(true);
      }
    },
  });

  // The accept button is unmounted the moment its 403 turns this into the confirm-first
  // screen; without this, focus would fall back to the document body and a keyboard user
  // would have to tab in from the top to reach the control that replaced it.
  useEffect(() => {
    if (!verificationRequired || !moveFocusToVerifyRef.current) {
      return;
    }
    moveFocusToVerifyRef.current = false;
    verifyHeadingRef.current?.focus();
  }, [verificationRequired]);

  async function onAccept(workspaceId: string): Promise<void> {
    setAccepting(true);
    setAcceptError(null);

    try {
      await api.post<WorkspaceMemberDto>(
        `/workspaces/${workspaceId}/invitations/${invitationId}/accept`,
      );

      await authClient.organization.setActive({ organizationId: workspaceId });

      // The dashboard this lands on says nothing about having joined — an invitee who already
      // had workspaces sees only the switcher label change. The Toaster is mounted in the root
      // layout, so this survives the navigation and arrives on the destination.
      toast.success(t('accepted'));
      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      if (isEmailVerificationRequired(caught, emailVerified)) {
        moveFocusToVerifyRef.current = true;
        setVerificationRequired(true);
        return;
      }
      setAcceptError(
        resolveApiMessage(caught, t, {
          fallback: 'error',
          byStatus: { 403: 'forbidden', 404: 'loadError' },
        }),
      );
    } finally {
      setAccepting(false);
    }
  }

  if (sessionPending) {
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
          {/* Signing in has to come back *here*: the invitation is the whole reason this
              visitor is being asked for credentials, and `/login` reads the destination out
              of this parameter (`lib/auth-redirect.ts`). */}
          <Link href={withNextParam('/login', inviteCallbackPath(invitationId))}>
            {t('signInCta')}
          </Link>
        </Button>
      </>
    );
  }

  if (verificationRequired) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h1
            ref={verifyHeadingRef}
            tabIndex={-1}
            className="font-display text-display tracking-tight"
          >
            {t('confirmTitle')}
          </h1>
          <p className="text-body text-muted-foreground">
            {t('confirmBody', { email: session.user.email })}
          </p>
          {linkError ? (
            <p className="text-body text-destructive">{tv(`linkErrors.${linkError}`)}</p>
          ) : null}
        </div>
        {/* The link comes back to this invitation, not to the generic confirmation page, so
            the invitee never has to find the original email again. */}
        <VerificationResend
          email={session.user.email}
          callbackPath={inviteCallbackPath(invitationId)}
        />
      </>
    );
  }

  if (loading) {
    return <p className="text-body text-muted-foreground">{t('loading')}</p>;
  }

  if (loadError !== null || invitation === null) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
          <p className="text-body text-destructive">{loadError ?? t('loadError')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('backToApp')}</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
        <p className="text-body text-muted-foreground">
          {t('subtitle', { workspace: invitation.workspaceName })}
        </p>
      </div>
      <p className="text-body text-destructive empty:hidden" role="status">
        {acceptError}
      </p>
      <Button
        type="button"
        disabled={accepting}
        onClick={() => void onAccept(invitation.workspaceId)}
      >
        {accepting ? t('submitPending') : t('submit')}
      </Button>
    </>
  );
}
