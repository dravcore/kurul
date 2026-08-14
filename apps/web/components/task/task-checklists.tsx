'use client';

import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ChecklistDto } from '@kurultay/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChecklistItemRow } from './checklist-item-row';

interface TaskChecklistsProps {
  /**
   * The checklists that were read. Empty is a real answer here — "not read yet" is `loading`
   * and "the read failed" is `loadFailed`, because `[]` on its own cannot tell the three
   * apart, and a board row carries no checklists at all (`TaskDto.checklists` is `null` there).
   */
  checklists: ChecklistDto[];
  canMutate?: boolean;
  /** A write is in flight somewhere in this section. */
  pending?: boolean;
  loading?: boolean;
  loadFailed?: boolean;
  onToggle: (itemId: string, isDone: boolean) => void;
  onAddChecklist?: (title: string) => Promise<boolean>;
  onRemoveChecklist?: (checklistId: string) => void;
  onAddItem?: (checklistId: string, content: string) => Promise<boolean>;
  onRemoveItem?: (itemId: string) => void;
}

/**
 * The task panel's checklist surface.
 *
 * Its own component rather than another section inside `task-metadata-panel.tsx`, which is
 * already the widest file in this folder and is the subject of issue #41 — adding a fifth
 * surface to it makes that split more expensive, not less.
 */
export function TaskChecklists({
  checklists,
  canMutate = true,
  pending = false,
  loading = false,
  loadFailed = false,
  onToggle,
  onAddChecklist,
  onRemoveChecklist,
  onAddItem,
  onRemoveItem,
}: TaskChecklistsProps): React.ReactElement | null {
  const t = useTranslations('app.board.task.checklist');
  const newTitleId = useId();
  const [newTitle, setNewTitle] = useState('');

  const canAdd = canMutate && onAddChecklist !== undefined;

  async function addChecklist(): Promise<void> {
    const title = newTitle.trim();
    if (title.length === 0 || !onAddChecklist) return;
    const created = await onAddChecklist(title);
    if (created) setNewTitle('');
  }

  // Nothing to show and nothing to offer. Returning an empty section instead would put a
  // heading over a void on every task that has no checklist, which is most of them.
  if (!loading && !loadFailed && checklists.length === 0 && !canAdd) return null;

  return (
    <section aria-label={t('sectionLabel')} className="flex flex-col gap-3">
      <p className="text-small font-medium text-foreground">{t('sectionLabel')}</p>

      {loading ? (
        <p className="text-small text-muted-foreground">{t('loading')}</p>
      ) : loadFailed ? (
        <p className="text-small text-muted-foreground">{t('loadError')}</p>
      ) : (
        <>
          {checklists.map((list) => {
            const done = list.items.filter((item) => item.isDone).length;
            return (
              <div key={list.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <h4 className="min-w-0 flex-1 text-body font-medium break-words">{list.title}</h4>
                  {/*
                    The ratio is for the eye; a screen reader announcing "1 slash 2" is not a
                    sentence. The visible node is hidden from the accessibility tree and the
                    same numbers are given in words beside it.
                  */}
                  <span aria-hidden className="text-micro text-muted-foreground">
                    {done}/{list.items.length}
                  </span>
                  <span className="sr-only">
                    {t('progress', { done, total: list.items.length })}
                  </span>
                  {canMutate && onRemoveChecklist ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      aria-label={t('removeChecklist', { title: list.title })}
                      onClick={() => onRemoveChecklist(list.id)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>

                {list.items.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {list.items.map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        disabled={!canMutate || pending}
                        onToggle={onToggle}
                        onRemove={canMutate && onRemoveItem ? onRemoveItem : undefined}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted-foreground">{t('noItems')}</p>
                )}

                {canMutate && onAddItem ? (
                  <AddItemForm checklistId={list.id} pending={pending} onAddItem={onAddItem} />
                ) : null}
              </div>
            );
          })}

          {canAdd ? (
            <div className="flex items-end gap-2">
              <div className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor={newTitleId}>{t('newChecklist')}</Label>
                <Input
                  id={newTitleId}
                  value={newTitle}
                  disabled={pending}
                  onChange={(event) => setNewTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    void addChecklist();
                  }}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => void addChecklist()}
              >
                {t('addChecklist')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The per-checklist "add item" field.
 *
 * Split out so each checklist owns its own draft. Held in the parent it would have to be a map
 * keyed by checklist id, and a stale key would type into the wrong list.
 */
function AddItemForm({
  checklistId,
  pending,
  onAddItem,
}: {
  checklistId: string;
  pending: boolean;
  onAddItem: (checklistId: string, content: string) => Promise<boolean>;
}): React.ReactElement {
  const t = useTranslations('app.board.task.checklist');
  const [content, setContent] = useState('');
  const fieldId = `new-checklist-item-${checklistId}`;

  async function add(): Promise<void> {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    const created = await onAddItem(checklistId, trimmed);
    if (created) setContent('');
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex min-w-40 flex-1 flex-col gap-1.5">
        <Label htmlFor={fieldId} className="sr-only">
          {t('newItem')}
        </Label>
        <Input
          id={fieldId}
          value={content}
          placeholder={t('newItem')}
          disabled={pending}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void add();
          }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void add()}
      >
        {t('addItem')}
      </Button>
    </div>
  );
}
