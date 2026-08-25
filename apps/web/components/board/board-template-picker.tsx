'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoardTemplateDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { labelSlotClass } from '@/components/task/label-chip';
import { cn } from '@/lib/utils';

interface BoardTemplatePickerProps {
  workspaceId: string;
  /** The chosen slug, or `null` while the catalog is still loading (or failed to). */
  value: string | null;
  onChange: (slug: string) => void;
}

/**
 * The starting-shape picker in the create-board dialog.
 *
 * **Nothing here knows which templates exist.** The catalog is fetched, rendered and echoed
 * back by slug, so adding a fifth template is an API change and not a release of both apps.
 * That is also why the selection is `string | null` rather than a union with a hardcoded
 * default: the first card the API returns is the default, and the web has no opinion about
 * which one that is.
 *
 * Native radios inside a `<fieldset>`, not a custom widget: arrow-key roving, the label/input
 * association and the group name in a screen reader all come free, and every one of them is
 * something a div-with-`role` has to reimplement.
 */
export function BoardTemplatePicker({
  workspaceId,
  value,
  onChange,
}: BoardTemplatePickerProps): React.ReactElement | null {
  const t = useTranslations('app.board');
  const [templates, setTemplates] = useState<BoardTemplateDto[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .get<BoardTemplateDto[]>(`/workspaces/${workspaceId}/board-templates`)
      .then((loaded) => {
        if (!live) return;
        setTemplates(loaded);
        // The catalog decides the default, and it is the first entry. Re-selecting on every
        // load would fight a user who opened the dialog, chose one, and closed it.
        const first = loaded[0];
        if (first && value === null) onChange(first.slug);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // Deliberately once per mount. `value` and `onChange` are read inside and would re-fetch
    // the catalog on every keystroke of the selection if they were dependencies; the dialog
    // unmounts its content when it closes, so "once per mount" is once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // A board is still creatable with no template — it gets the default columns, which is what
  // this dialog did before templates existed. Failing the whole form over a catalog nobody
  // has chosen from yet would be the worse trade, so this says what will happen instead.
  //
  // `role="status"` and not the shared `SubmitError`: that component moves focus to itself,
  // which is right for a failure the user caused by submitting and wrong for one that is
  // already on screen when the dialog opens — it would take the caret out of the name field
  // before anyone has typed a character.
  if (failed) {
    return (
      <p role="status" className="text-small text-muted-foreground">
        {t('templateError')}
      </p>
    );
  }
  if (templates.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-small font-medium text-foreground">{t('template')}</legend>
      <div className="flex flex-col gap-1.5">
        {templates.map((template) => (
          <label
            key={template.slug}
            className={cn(
              'flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors',
              'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
              // `border-signature`, not `border-ring`: the two tokens hold the same copper
              // today, so a selected card and a focused one were telling the cascade the same
              // thing by accident. Selection is the rail; focus is the ring.
              template.slug === value
                ? 'border-signature bg-muted/40'
                : 'border-border hover:border-border-strong hover:bg-muted/40',
            )}
          >
            <input
              type="radio"
              name="board-template"
              className="mt-0.5 accent-primary"
              value={template.slug}
              checked={template.slug === value}
              onChange={() => onChange(template.slug)}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-small font-medium text-foreground">{template.name}</span>
              <span className="text-small text-muted-foreground">{template.description}</span>
              {/*
                The columns in board order, which is the order they were sent in. A separator
                rather than chips: these are stages of one flow, and eight chips in a row read
                as eight unrelated tags.
              */}
              <span className="text-small text-muted-foreground">
                {template.columns.map((column) => column.name).join(' → ')}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {template.labels.map((label) => (
                  <span
                    key={label.name}
                    className="inline-flex items-center gap-1 text-small text-muted-foreground"
                  >
                    <span
                      className={cn('size-1.5 rounded-full', labelSlotClass(label.color))}
                      aria-hidden
                    />
                    {label.name}
                  </span>
                ))}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
