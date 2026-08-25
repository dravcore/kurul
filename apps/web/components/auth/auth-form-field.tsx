'use client';

import { useId } from 'react';
import type { ChangeEventHandler, HTMLInputTypeAttribute } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A form field for auth screens (sign-up, login, etc.).
 *
 * Supports field-level error messages that appear below the input. Errors are typically
 * populated by parsing a Better Auth `error.code` — for example, `PASSWORD_TOO_SHORT`
 * maps to a message key, which the caller resolves through i18n and passes here.
 */
export function AuthFormField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required = true,
  minLength,
  error,
}: Readonly<{
  label: string;
  type?: HTMLInputTypeAttribute;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  /** Field-specific error message, shown below the input. */
  error?: string | null;
}>): React.ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-body text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
