import type { ChangeEventHandler, HTMLInputTypeAttribute } from 'react';

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
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
        type={type}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
      />
    </label>
  );
}
