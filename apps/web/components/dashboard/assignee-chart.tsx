'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardCountByAssignee } from '@kurultay/shared-types';
import { useTranslations } from 'next-intl';
import { ChartTableToggle } from './chart-table-toggle';

export function AssigneeChart({
  data,
}: Readonly<{
  data: DashboardCountByAssignee[];
}>): React.ReactElement {
  const t = useTranslations('app.dashboard');

  const chartData = data.map((row) => ({
    ...row,
    label:
      row.name === 'Unassigned' ? t('unassigned') : row.name === 'Other' ? t('other') : row.name,
  }));

  return (
    <ChartTableToggle
      title={t('assigneeTitle')}
      columns={[t('tableName'), t('tableCount')]}
      rows={chartData.map((row) => [row.label, row.count])}
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
              dataKey="label"
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
            <Bar dataKey="count" fill="var(--label-slot-1)" radius={[0, 4, 4, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      }
    />
  );
}
