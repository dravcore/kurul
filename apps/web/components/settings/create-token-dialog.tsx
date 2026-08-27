'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  CreatePersonalAccessTokenRequest,
  CreatedPersonalAccessTokenDto,
} from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { FormDialog } from '@/components/common/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface CreateTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** The created token, plaintext included: `TokenSettings` hands it straight to the
   * one-time reveal dialog rather than folding it into the list itself. */
  onCreated: (token: CreatedPersonalAccessTokenDto) => void;
}

type ExpiryOption = 'none' | 'days30' | 'days90' | 'year1';

const EXPIRY_OPTIONS: readonly ExpiryOption[] = ['none', 'days30', 'days90', 'year1'];

/** Days out from now for every option but `none`, which needs no `expiresAt` at all. */
const EXPIRY_DAYS: Readonly<Partial<Record<ExpiryOption, number>>> = {
  days30: 30,
  days90: 90,
  year1: 365,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function expiresAtFor(option: ExpiryOption): string | undefined {
  const days = EXPIRY_DAYS[option];
  return days === undefined ? undefined : new Date(Date.now() + days * DAY_MS).toISOString();
}

const MAX_NAME_LENGTH = 80;

/**
 * Mint a personal access token for the signed-in member, in this workspace.
 *
 * No role picker: unlike an invitation, a token carries no role of its own (see
 * `CreatePersonalAccessTokenRequest` in `@kurul/shared-types`): it acts as whoever created it,
 * with whatever role they hold at the time it authenticates a request.
 */
export function CreateTokenDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: CreateTokenDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.tokens');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ExpiryOption>('none');
  const nameRef = useRef<HTMLInputElement>(null);

  async function onSubmit(): Promise<void> {
    const body: CreatePersonalAccessTokenRequest = {
      name: name.trim(),
      expiresAt: expiresAtFor(expiry),
    };
    const token = await api.post<CreatedPersonalAccessTokenDto, CreatePersonalAccessTokenRequest>(
      `/workspaces/${workspaceId}/tokens`,
      body,
    );
    onCreated(token);

    // This dialog is not unmounted when it closes, only its body is, so the fields have to be
    // reset here or the next token opens pre-filled with the previous one's name and expiry,
    // same reasoning as `InviteMemberDialog` clearing the address.
    setName('');
    setExpiry('none');
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createTitle')}
      cancelLabel={t('cancel')}
      submitLabel={t('createSubmit')}
      submitDisabled={name.trim().length === 0}
      initialFocusRef={nameRef}
      onSubmit={onSubmit}
      resolveError={(caught) =>
        resolveApiMessage(caught, t, {
          fallback: 'createError',
          byStatus: {
            400: 'createErrorValidation',
          },
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="create-token-name">{t('nameLabel')}</Label>
        <Input
          id="create-token-name"
          ref={nameRef}
          type="text"
          required
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="create-token-expiry">{t('expiryLabel')}</Label>
        <Select
          id="create-token-expiry"
          value={expiry}
          onChange={(event) => setExpiry(event.target.value as ExpiryOption)}
        >
          {EXPIRY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`expiryOptions.${option}`)}
            </option>
          ))}
        </Select>
      </div>
    </FormDialog>
  );
}
