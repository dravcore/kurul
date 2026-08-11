'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** Renders the confirm button in the destructive variant. */
  destructive?: boolean;
  /** Blocks the action while `description` still explains why (a column that has tasks). */
  confirmDisabled?: boolean;
  /**
   * Runs the action. Resolving closes the dialog; rejecting keeps it open and shows
   * `resolveError(caught)` above the footer, which is where the 403/409 wording belongs.
   */
  onConfirm: () => Promise<void>;
  resolveError: (caught: unknown) => string;
}

/**
 * The confirm-or-cancel half of every destructive flow: title, reason, the two buttons, and
 * the pending/error bookkeeping that sits between them.
 *
 * Owning `pending` and `error` here is the point — each caller previously carried its own
 * pair of `useState`s plus the `finally { setPending(false) }` that is easy to drop on the
 * error path, leaving a dialog stuck behind a disabled button.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  resolveError,
}: ConfirmDialogProps): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A dialog reopened after a failure must not still be showing the previous reason.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(resolveError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {error ? <p className="text-body text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending || confirmDisabled}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
