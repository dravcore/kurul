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
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-small text-muted-foreground">{label}</p>
      <p
        className={
          emphasize && value > 0
            ? 'mt-1 text-stat tracking-tight text-destructive'
            : 'mt-1 text-stat tracking-tight text-foreground'
        }
      >
        {value.toLocaleString('en-US')}
      </p>
    </div>
  );
}
