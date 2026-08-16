'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { api, resolveApiMessage } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { disconnectSocket } from '@/lib/socket';
import { ConfirmDialog } from '@/components/common/confirm-dialog';

interface LeaveWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

/**
 * The caller walks out of the workspace they are looking at.
 *
 * Unlike every other action on this screen, the result is not a row changing — it is this
 * screen losing the right to exist. So the dialog owns the whole aftermath rather than
 * reporting back to the list:
 *
 * - **`setActive(null)`** because the session still names this workspace as the active one,
 *   and Better Auth's session store is what the shell bootstraps from. Clearing it through the
 *   auth client is what makes that store refetch; a bare `router.refresh()` would re-render the
 *   server tree against a client session that still points at a workspace the user just left,
 *   and every workspace-scoped request on the destination would answer `404`.
 * - **`disconnectSocket()`** because the server evicts the user's rooms
 *   (`WorkspaceMemberService.leave`) but the socket itself stays connected, still authenticated
 *   as a session whose active workspace has just changed underneath it.
 * - **A toast**, because the destination says nothing about what happened: someone with other
 *   workspaces just sees the switcher label change (docs/design.md §7).
 */
export function LeaveWorkspaceDialog({
  open,
  onOpenChange,
  workspaceId,
}: LeaveWorkspaceDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.members');
  const router = useRouter();

  async function onConfirm(): Promise<void> {
    await api.post(`/workspaces/${workspaceId}/members/me/leave`);

    disconnectSocket();
    await authClient.organization.setActive({ organizationId: null });

    toast.success(t('leaveDone'));
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('leaveTitle')}
      description={t('leaveBody')}
      cancelLabel={t('cancel')}
      confirmLabel={t('leaveAction')}
      destructive
      onConfirm={onConfirm}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'leaveError',
          // The only refusal with a real next move: a sole owner has to hand the workspace over
          // (or delete it) before they can walk away from it.
          byStatus: { 409: 'leaveErrorLastOwner' },
        })
      }
    />
  );
}
