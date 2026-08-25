'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function ChartTableToggle({
  title,
  chart,
  columns,
  rows,
}: Readonly<{
  title: string;
  chart: React.ReactNode;
  columns: string[];
  rows: Array<Array<string | number>>;
}>): React.ReactElement {
  const t = useTranslations('app.dashboard');
  const [asTable, setAsTable] = useState(false);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-title">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAsTable((value) => !value)}
        >
          {asTable ? t('viewChart') : t('viewTable')}
        </Button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-small">
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 tabular-nums text-foreground">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56 w-full min-w-0">{chart}</div>
      )}
    </section>
  );
}
