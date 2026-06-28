'use client'

import { Card } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { MoneyVsPaper } from '@/app/actions/trades'

const fmt = (v: number) =>
  `${v >= 0 ? '+' : ''}${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`

export function MoneyProfitChart({ stats }: { stats: MoneyVsPaper }) {
  const { money, paper } = stats
  const decisiveMoney = money.wins + money.losses
  const decisivePaper = paper.wins + paper.losses
  const total = decisiveMoney + decisivePaper

  const data = [
    { name: 'Mit Geld', value: money.avgPnL, n: decisiveMoney },
    { name: 'Demo', value: paper.avgPnL, n: decisivePaper },
  ]
  const color = (v: number) => (v >= 0 ? 'var(--positive)' : 'var(--destructive)')

  return (
    <Card className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Ø Gewinn pro Trade</h3>
          <p className="text-xs text-muted-foreground">Mit echtem Geld vs. Demo</p>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <TrendingUp className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Noch keine Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Schließe Trades ab, um den Ø Gewinn zu sehen.
          </p>
        </div>
      ) : (
        <ChartContainer
          config={{ value: { label: 'Ø Gewinn' } }}
          className="aspect-auto h-[200px] w-full"
        >
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              className="font-mono text-[10px]"
            />
            <YAxis hide />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90}>
              {data.map((d) => (
                <Cell key={d.name} fill={color(d.value)} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                className="fill-foreground font-mono text-xs font-semibold"
                formatter={(v) => fmt(Number(v))}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}

      <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground">
        Mit Geld gesamt:{' '}
        <span className={money.totalPnL >= 0 ? 'text-positive' : 'text-destructive'}>
          {fmt(money.totalPnL)}
        </span>{' '}
        · Demo gesamt:{' '}
        <span className={paper.totalPnL >= 0 ? 'text-positive' : 'text-destructive'}>
          {fmt(paper.totalPnL)}
        </span>
      </p>
    </Card>
  )
}
