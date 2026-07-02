'use client'

import { Card } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import type { EquityStats } from '@/app/actions/trades'
import { Wallet } from 'lucide-react'

const eur0 = (n: number) =>
  n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function EquityChart({ stats }: { stats: EquityStats }) {
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
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Wallet className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Equity-Kurve</h3>
          <p className="text-xs text-muted-foreground">
            Kontostand über Zeit — nur Echtgeld, nach Gebühren
          </p>
        </div>
      </div>

      {!hasData ? (
        <div className="flex h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
          <Wallet className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Noch keine Echtgeld-Trades</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Sobald du Echtgeld-Trades abschließt, wächst hier deine Equity-Kurve.
          </p>
        </div>
      ) : (
        <ChartContainer
          config={{ balance: { label: 'Kontostand', color: 'var(--chart-1)' } }}
          className="h-[240px] w-full"
        >
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="fillEquity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-balance)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-balance)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={64}
              tickFormatter={(v) => eur0(Number(v))}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              domain={['auto', 'auto']}
            />
            <ReferenceLine
              y={stats.startCapital}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
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
            />
          </AreaChart>
        </ChartContainer>
      )}
    </Card>
  )
}
