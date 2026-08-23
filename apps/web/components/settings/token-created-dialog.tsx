'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { CreatedPersonalAccessTokenDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TokenCreatedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` while nothing has just been created: the dialog stays unmounted for that state. */
  token: CreatedPersonalAccessTokenDto | null;
}

/**
 * The one and only place a token's plaintext is ever shown. `POST /workspaces/:workspaceId/tokens`
 * is the only response that carries it (the server keeps nothing but a hash afterwards), so
 * there is nowhere to reopen this from once it closes, on purpose.
 *
 * Closing this dialog is also what turns the newly created token into an ordinary row: see
 * `TokenSettings`, which only appends to its list on `onOpenChange(false)` here rather than at
 * creation time, so the row never appears a beat before the plaintext someone might still be
 * about to copy.
 */
export function TokenCreatedDialog({
  open,
  onOpenChange,
  token,
}: TokenCreatedDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.tokens');

  async function onCopy(): Promise<void> {
    if (!token) return;
    // Same reasoning as the invitation accept-link copy in `MembersSettings`: `clipboard` is
    // absent over plain HTTP and in older browsers, and a button that silently does nothing is
    // worse than one that says why.
    try {
      await navigator.clipboard.writeText(token.token);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyError'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('createdTitle')}</DialogTitle>
          <DialogDescription>{t('createdBody')}</DialogDescription>
        </DialogHeader>
        {token ? (
          <p className="break-all rounded-md border border-input bg-muted/40 p-3 font-mono text-small text-foreground">
            {token.token}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void onCopy()}>
            {t('copyAction')}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
