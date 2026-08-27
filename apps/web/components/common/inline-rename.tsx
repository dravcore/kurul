'use client';

import { useEffect, useRef, useState } from 'react';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface InlineRenameField {
  /** `Input`/`Label` pairing id: unique on the page, not just among this form's own fields. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * The field the whole save gates on: trimmed empty at submit time cancels instead of saving,
   * which is the "empty name restores the old name, no request" rule both call sites share. At
   * most one field should carry this; the first one found is the one actually enforced.
   */
  required?: boolean;
}

export interface InlineRenameProps {
  /** The name field, and (for a board) the description field alongside it, in order. */
  fields: readonly InlineRenameField[];
  saveLabel: string;
  cancelLabel: string;
  /**
   * Persists the fields. Resolving lets the caller close the editor; rejecting keeps it open
   * with `resolveError(caught)` shown inline, the same contract `FormDialog.onSubmit` uses,
   * because this replaces what a `FormDialog` did at both call sites.
   */
  onSave: () => Promise<void>;
  /**
   * Escape, or Enter/Save with the required field trimmed empty. The caller restores the
   * original values, closes the editor, and returns focus to whatever opened it.
   */
  onCancel: () => void;
  resolveError: (caught: unknown) => string;
}

/**
 * The board-card and workspace-settings rename editors (P7 task 6): a named affordance still
 * opens it, but the editing itself happens in place instead of inside a dialog.
 *
 * Enter (from any field) and the visible Save button share this component's one submit path;
 * Escape and the visible Cancel button share the one cancel path. That is the whole of the
 * keyboard/mouse parity the brief asks for: one handler reached two ways, not two
 * implementations kept in sync by hand.
 */
export function InlineRename({
  fields,
  saveLabel,
  cancelLabel,
  onSave,
  onCancel,
  resolveError,
}: InlineRenameProps): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Opens with the name focused and selected: `select()` alone is not guaranteed to focus the
  // element (it did not in jsdom), and `focus()` alone would leave typing landing in the middle
  // of the value instead of replacing it.
  useEffect(() => {
    firstFieldRef.current?.focus();
    firstFieldRef.current?.select();
  }, []);

  async function submit(): Promise<void> {
    if (pending) return;
    const requiredField = fields.find((field) => field.required);
    if (requiredField && requiredField.value.trim().length === 0) {
      onCancel();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave();
    } catch (caught) {
      setError(resolveError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    // The rule reads a `form` as static and asks for a role; nothing here is made interactive.
    // The handler below only catches Escape on its way up from the fields and buttons, which
    // keep every affordance they had (same shape as `task-composer.tsx`).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      data-slot="inline-rename"
      aria-busy={pending ? true : undefined}
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onCancel();
      }}
    >
      {fields.map((field, index) => (
        <div key={field.id} className="flex flex-col gap-1">
          <Label htmlFor={field.id}>{field.label}</Label>
          <Input
            id={field.id}
            ref={index === 0 ? firstFieldRef : undefined}
            value={field.value}
            // `readOnly`, never `disabled`: a disabled field drops focus mid-request, and this
            // editor holds to the same "focus must not drop" rule as the composer.
            readOnly={pending}
            onChange={(event) => field.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Implicit submission is not something jsdom performs, so the one key gesture
              // this editor has is dispatched here rather than left to the browser.
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
        </div>
      ))}
      {error !== null ? (
        // Focus stays in the field being corrected rather than jumping to the alert: unlike a
        // dialog, this editor has nowhere else worth sending it, and Enter-to-retry only works
        // if the caret is still where the user left it.
        <SubmitError message={error} focusOnMount={false} />
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {saveLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}
