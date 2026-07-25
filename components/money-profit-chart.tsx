'use client'

import { ChartContainer } from '@/components/ui/chart'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import { CHART_AXIS, CHART_MOTION } from '@/lib/chart-theme'
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
    <div className="panel sheen flex h-full flex-col p-4 sm:p-6">
      <ChartHeader
        icon={TrendingUp}
        title="Ø Gewinn pro Trade"
        subtitle="Mit echtem Geld vs. Demo"
      />

      {total === 0 ? (
        <ChartEmpty
          icon={TrendingUp}
          className="flex-1 py-10"
          title="Noch keine Daten"
          hint="Schließe Trades ab, um den Ø Gewinn zu sehen."
        />
      ) : (
        <ChartContainer
          config={{ value: { label: 'Ø Gewinn' } }}
          className="aspect-auto h-[200px] w-full"
        >
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="name" {...CHART_AXIS} />
            <YAxis hide />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90} {...CHART_MOTION}>
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
    </div>
  )
}
