'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { BoardTemplateDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { labelSlotClass } from '@/components/task/label-chip';
import { Button } from '@/components/ui/button';
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
 *
 * The fieldset itself starts behind a "Change template" disclosure. The catalog's first entry
 * is already selected by the time anyone can see this (the effect below picks it silently), so
 * the dialog opens on name, description and one line of text instead of four full-height
 * template cards. That line names the selected template rather than only offering to change it:
 * a board seeded with a template's columns and labels must not be the outcome of a choice
 * nothing on screen admitted was made. Expanding is one-directional: once the fieldset is
 * revealed it is exactly the card list this component always rendered, with nothing new added
 * above it to collapse again. Expanding also unmounts the toggle button that carried keyboard
 * focus, so the click handler hands focus to the first radio itself (`flushSync` + a ref) rather
 * than letting the browser drop it and Radix's dialog focus-trap silently recapture it on an
 * invisible target.
 */
export function BoardTemplatePicker({
  workspaceId,
  value,
  onChange,
}: BoardTemplatePickerProps): React.ReactElement | null {
  const t = useTranslations('app.board');
  const [templates, setTemplates] = useState<BoardTemplateDto[]>([]);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const firstRadioRef = useRef<HTMLInputElement>(null);

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

  if (!expanded) {
    // `value` is `null` only for the render between the catalog arriving and the effect above
    // echoing the first slug back, and the first entry is what that effect settles on.
    const selected = templates.find((template) => template.slug === value) ?? templates[0]!;
    return (
      <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
        <span>{t('changeTemplateWith', { name: selected.name })}</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={false}
          onClick={() => {
            // The fieldset mounts in the same render that unmounts this button, so a plain
            // `setExpanded(true)` leaves nothing focused: the browser drops `activeElement` to
            // `<body>` the instant this button is removed, and Radix's FocusScope (this dialog
            // traps focus) reacts to exactly that by focusing its own content wrapper, which is
            // `outline-none`, an invisible focus target. `flushSync` forces the fieldset to
            // exist before that fallback can run, so the explicit `.focus()` below wins the
            // race instead.
            flushSync(() => setExpanded(true));
            firstRadioRef.current?.focus();
          }}
        >
          {t('changeTemplate')}
        </Button>
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-small font-medium text-foreground">{t('template')}</legend>
      <div className="flex flex-col gap-1.5">
        {templates.map((template, index) => (
          <label
            key={template.slug}
            className={cn(
              'flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors',
              'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
              // `border-signature`, not `border-ring`: the two tokens hold the same copper
              // today, so a selected card and a focused one were telling the cascade the same
              // thing by accident. Selection is the rail; focus is the ring.
              template.slug === value
                ? 'border-signature bg-signature-subtle'
                : 'border-border hover:border-border-strong hover:bg-accent',
            )}
          >
            <input
              ref={index === 0 ? firstRadioRef : undefined}
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
