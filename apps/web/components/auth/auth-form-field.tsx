'use client';

import { useId } from 'react';
import type { ChangeEventHandler, HTMLInputTypeAttribute } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AuthFormField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  required = true,
  minLength,
}: Readonly<{
  label: string;
  type?: HTMLInputTypeAttribute;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
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
      />
    </div>
  );
}
