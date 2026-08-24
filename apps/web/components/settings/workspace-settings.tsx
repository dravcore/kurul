'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWorkspaceContext } from '@/components/layout/workspace-provider';
import { canDeleteWorkspace, canRenameWorkspace } from '@/lib/workspace-permissions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteWorkspaceDialog } from './delete-workspace-dialog';
import { RenameWorkspaceDialog } from './rename-workspace-dialog';

/** Row height matches the list/table row in docs/design.md §4, same as `MembersSettings`. */
const ROW = 'flex min-h-9 items-center justify-between gap-3 py-1.5';

/**
 * Identity and lifecycle of the workspace itself: its name, and — for the one role that may —
 * the ability to delete it.
 *
 * `MembersSettings` reads its data through its own `useApiResource` fetch. This section does
 * not need one: `WorkspaceProvider`'s bootstrap already carries the active workspace's `name`
 * (and, since #167, the roster load carries the caller's `role`), so a dedicated request here
 * would be a second read of a value the shell already holds.
 */
export function WorkspaceSettings(): React.ReactElement {
  const t = useTranslations('app.settings.workspace');
  const tShell = useTranslations('app.shell');
  const { workspaces, activeId, activeRole, bootstrapped, renameActiveWorkspace } =
    useWorkspaceContext();

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const workspace = workspaces.find((item) => item.id === activeId);

  // Same reasoning as `MembersSettings`: no resolved workspace yet is the shell still
  // bootstrapping, not a request this section started and failed, so it waits.
  if (!bootstrapped || !workspace) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy>
        <span className="sr-only">{tShell('loading')}</span>
        <Skeleton className="h-9 w-full rounded-[var(--radius-md)]" />
      </div>
    );
  }

  const canRename = canRenameWorkspace(activeRole);
  const canDelete = canDeleteWorkspace(activeRole);

  return (
    <div className="flex flex-col gap-6">
      <div className={ROW}>
        <p className="min-w-0 truncate text-body text-foreground">{workspace.name}</p>
        {/* Never drawn for anyone the API would only ever answer 403 to (see
            `workspace-permissions.ts`) — the same "no control that can only be refused" rule
            `MembersSettings` follows for the member-management menu. */}
        {canRename ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
            {t('renameAction')}
          </Button>
        ) : null}
      </div>

      {canDelete ? (
        <div className={ROW}>
          <div className="min-w-0">
            <p className="text-body text-foreground">{t('deleteSectionTitle')}</p>
            <p className="text-small text-muted-foreground">{t('deleteSectionBody')}</p>
          </div>
          <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            {t('deleteAction')}
          </Button>
        </div>
      ) : null}

      <RenameWorkspaceDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        workspace={workspace}
        onRenamed={renameActiveWorkspace}
      />
      {/* Mounted only for an OWNER: unlike `RenameWorkspaceDialog`, whose open state a
          non-manager can never reach because the button above it is already gone, this dialog
          also needs `canDeleteWorkspace` to have been true to construct at all — there is no
          state under which a non-OWNER's `deleteOpen` could become `true`, but keeping the
          mount itself behind the same guard means that stays true even if a future edit adds
          a second way to flip it. */}
      {canDelete ? (
        <DeleteWorkspaceDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          workspace={workspace}
        />
      ) : null}
    </div>
  );
}
