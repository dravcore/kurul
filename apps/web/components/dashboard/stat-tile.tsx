'use client';

export function StatTile({
  label,
  value,
  emphasize = false,
}: Readonly<{
  label: string;
  value: number;
  emphasize?: boolean;
}>): React.ReactElement {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border px-4 py-3">
      <p className="text-small text-muted-foreground">{label}</p>
      <p
        className={
          emphasize && value > 0
            ? 'mt-1 text-[28px] font-semibold tracking-tight text-destructive tabular-nums'
            : 'mt-1 text-[28px] font-semibold tracking-tight text-foreground tabular-nums'
        }
      >
        {value.toLocaleString('en-US')}
      </p>
    </div>
  );
}
