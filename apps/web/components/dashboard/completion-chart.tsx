'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardThroughputDay } from '@kurul/shared-types';
import { useTranslations } from 'next-intl';
import { ChartTableToggle } from './chart-table-toggle';

export function CompletionChart({
  data,
}: Readonly<{
  data: DashboardThroughputDay[];
}>): React.ReactElement {
  const t = useTranslations('app.dashboard');

  const chartData = data.map((row) => ({
    ...row,
    label: row.date.slice(5),
  }));

  return (
    <ChartTableToggle
      title={t('throughputTitle')}
      columns={[t('tableDate'), t('seriesCreated'), t('seriesCompleted')]}
      rows={chartData.map((row) => [row.date, row.created, row.completed])}
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              tickMargin={8}
            />
            <YAxis
              allowDecimals={false}
              width={32}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 8,
              }}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as DashboardThroughputDay | undefined;
                return point?.date ?? '';
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="created"
              name={t('seriesCreated')}
              stroke="var(--label-slot-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="completed"
              name={t('seriesCompleted')}
              stroke="var(--signature)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      }
    />
  );
}
