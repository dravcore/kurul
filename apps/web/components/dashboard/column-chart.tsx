'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardCountByColumn } from '@kurul/shared-types';
import { useTranslations } from 'next-intl';
import { ChartTableToggle } from './chart-table-toggle';

export function ColumnChart({
  data,
}: Readonly<{
  data: DashboardCountByColumn[];
}>): React.ReactElement {
  const t = useTranslations('app.dashboard');

  const chartData = [...data].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );

  return (
    <ChartTableToggle
      title={t('columnTitle')}
      columns={[t('tableName'), t('tableCount')]}
      rows={chartData.map((row) => [row.name, row.count])}
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={96}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)' }}
              contentStyle={{
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 8,
              }}
            />
            <Bar dataKey="count" fill="var(--label-slot-3)" radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      }
    />
  );
}
