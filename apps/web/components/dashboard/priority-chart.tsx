'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardCountByPriority } from '@kurul/shared-types';
import { useTranslations } from 'next-intl';
import { ChartTableToggle } from './chart-table-toggle';

const PRIORITY_FILL: Record<string, string> = {
  LOW: 'var(--priority-low)',
  MEDIUM: 'var(--priority-medium)',
  HIGH: 'var(--priority-high)',
  URGENT: 'var(--priority-urgent)',
};

export function PriorityChart({
  data,
}: Readonly<{
  data: DashboardCountByPriority[];
}>): React.ReactElement {
  const t = useTranslations('app.dashboard');
  const tPriority = useTranslations('app.board.task.priorityValues');

  const chartData = data.map((row) => ({
    ...row,
    label: tPriority(row.priority),
    fill: PRIORITY_FILL[row.priority] ?? 'var(--foreground)',
  }));

  return (
    <ChartTableToggle
      title={t('priorityTitle')}
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
              width={72}
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
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
              {chartData.map((entry) => (
                <Cell key={entry.priority} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      }
    />
  );
}
