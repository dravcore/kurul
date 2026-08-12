'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ColumnCategory, type ColumnDto, type UpdateColumnRequest } from '@kurultay/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/**
 * Presentation order, not the enum's declaration order: the list reads as a workflow, left of
 * the board to the right of it, with the two end states last. Written out rather than derived
 * from `Object.values` so adding a category to the enum is a deliberate decision about where
 * it belongs in this list, not a silent append.
 */
const CATEGORY_ORDER = [
  ColumnCategory.BACKLOG,
  ColumnCategory.UNSTARTED,
  ColumnCategory.STARTED,
  ColumnCategory.COMPLETED,
  ColumnCategory.CANCELED,
] as const;

interface ColumnSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  column: ColumnDto | null;
  onSaved: (column: ColumnDto) => void;
}

/**
 * Name and category for one column.
 *
 * The category is here rather than inferred from the name because the dashboard reads it and
 * the name no longer tells it anything — a user who calls their finished column "Shipped" has
 * to be able to say that it means finished, or their completion metrics stay at zero
 * (docs/decisions/0019-column-category.md).
 */
export function ColumnSettingsDialog({
  open,
  onOpenChange,
  workspaceId,
  column,
  onSaved,
}: ColumnSettingsDialogProps): React.ReactElement {
  const t = useTranslations('app.board.column');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ColumnCategory>(ColumnCategory.UNSTARTED);

  useEffect(() => {
    if (!column) return;
    setName(column.name);
    setCategory(column.category);
  }, [column]);

  async function onSubmit(): Promise<void> {
    if (!column) return;
    const body: UpdateColumnRequest = { name: name.trim(), category };
    const updated = await api.patch<ColumnDto, UpdateColumnRequest>(
      `/workspaces/${workspaceId}/columns/${column.id}`,
      body,
    );
    onSaved(updated);
    // The only write on the board whose result the board cannot show: a renamed column is
    // visible in its own header, but `category` exists solely for the dashboard's benefit
    // (see `categoryHint`), so changing it alone closes the dialog over an unchanged board.
    toast.success(t('settingsSaved'));
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settingsTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('settingsAction')}
      submitDisabled={name.trim().length === 0}
      onSubmit={onSubmit}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, { fallback: 'settingsError', byStatus: { 403: 'forbidden' } })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="column-settings-name">{t('name')}</Label>
        <Input
          id="column-settings-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="column-settings-category">{t('category')}</Label>
        <Select
          id="column-settings-category"
          aria-describedby="column-settings-category-hint"
          value={category}
          onChange={(event) => setCategory(event.target.value as ColumnCategory)}
        >
          {CATEGORY_ORDER.map((value) => (
            <option key={value} value={value}>
              {t(`categoryOption.${value}`)}
            </option>
          ))}
        </Select>
        {/* Helper text, not a label: the control names the field, this explains what picking
            a value does. Reports are the only thing reading it today. */}
        <p className="text-small text-muted-foreground" id="column-settings-category-hint">
          {t('categoryHint')}
        </p>
      </div>
    </FormDialog>
  );
}
