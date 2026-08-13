'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UpdateWorkspaceRequest, WorkspaceDto } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RenameWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceDto;
  onRenamed: (workspace: WorkspaceDto) => void;
}

/**
 * Rename the workspace itself — not a board, not a member, the organization every other
 * section on this settings screen is scoped to.
 *
 * Only `name` is on offer here, unlike the create-workspace form (`/workspaces/new`) which
 * also collects `slug`. `UpdateWorkspaceRequest.slug` exists on the wire because
 * `UpdateWorkspaceDto` treats it as an independently settable field, but nothing under
 * `apps/web/app/(app)` resolves a route, a link, or an invite by slug — every one of them is
 * `workspaceId`-scoped. A slug field here would be a control over a value with no visible
 * effect anywhere in the product, which is worse than leaving it out.
 *
 * There is exactly one workspace this dialog can ever be pointed at — the active one — so
 * unlike `RenameBoardDialog` it does not need the "reload the fields when a different subject
 * is handed over" guard: Radix unmounts `FormDialog`'s body on close (see the comment on
 * `FormDialogBody`), so every open already starts from `workspace.name` as it stands right now.
 */
export function RenameWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  onRenamed,
}: RenameWorkspaceDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.workspace');
  const [name, setName] = useState(workspace.name);

  async function onSubmit(): Promise<void> {
    const body: UpdateWorkspaceRequest = { name: name.trim() };
    const updated = await api.patch<WorkspaceDto, UpdateWorkspaceRequest>(
      `/workspaces/${workspace.id}`,
      body,
    );
    onRenamed(updated);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('renameTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('renameAction')}
      submitDisabled={name.trim().length === 0}
      onSubmit={onSubmit}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'renameError',
          byStatus: { 403: 'renameErrorForbidden', 404: 'renameErrorGone' },
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rename-workspace-name">{t('name')}</Label>
        <Input
          id="rename-workspace-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}
