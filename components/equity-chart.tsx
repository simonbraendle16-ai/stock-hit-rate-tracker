'use client'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import type { EquityStats } from '@/lib/trade-stats'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import {
  AREA_FILL,
  CHART_AXIS,
  CHART_GRID,
  CHART_MOTION,
  CHART_REFERENCE,
} from '@/lib/chart-theme'
import { Wallet } from 'lucide-react'
import { formatMoney } from '@/lib/format'

export function EquityChart({
  stats,
  currency = 'EUR',
}: {
  stats: EquityStats
  currency?: string
}) {
  const eur0 = (n: number) => formatMoney(n, currency, { maximumFractionDigits: 0 })
  const chartData = [
    { index: 0, label: 'Start', balance: Number(stats.startCapital.toFixed(2)) },
    ...stats.points.map((p, i) => ({
      index: i + 1,
      label: p.label,
      balance: Number(p.balance.toFixed(2)),
    })),
  ]
  const hasData = stats.points.length > 0

  return (
    <div className="panel sheen p-4 sm:p-6">
      <ChartHeader
        icon={Wallet}
        title="Equity-Kurve"
        subtitle="Kontostand über Zeit — nur Echtgeld, nach Gebühren"
      />

      {!hasData ? (
        <ChartEmpty
          icon={Wallet}
          className="h-[240px]"
          title="Noch keine Echtgeld-Trades"
          hint="Sobald du Echtgeld-Trades abschließt, wächst hier deine Equity-Kurve."
        />
      ) : (
        <ChartContainer
          config={{ balance: { label: 'Kontostand', color: 'var(--chart-1)' } }}
          className="h-[240px] w-full"
        >
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="fillEquity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-balance)" stopOpacity={AREA_FILL.top} />
                <stop offset="95%" stopColor="var(--color-balance)" stopOpacity={AREA_FILL.bottom} />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="label" minTickGap={24} {...CHART_AXIS} />
            <YAxis
              width={64}
              tickFormatter={(v) => eur0(Number(v))}
              domain={['auto', 'auto']}
              {...CHART_AXIS}
            />
            <ReferenceLine y={stats.startCapital} {...CHART_REFERENCE} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => [eur0(Number(value)), ' Kontostand']}
                  labelFormatter={(label) => `Datum: ${label}`}
                />
              }
            />
            <Area
              dataKey="balance"
              type="monotone"
              stroke="var(--color-balance)"
              strokeWidth={2}
              fill="url(#fillEquity)"
              dot={chartData.length <= 30}
              activeDot={{ r: 4 }}
              {...CHART_MOTION}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}
