'use client'

import { Card } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { Target } from 'lucide-react'
import type { MoneyVsPaper } from '@/app/actions/trades'

export function MoneyHitRateChart({ stats }: { stats: MoneyVsPaper }) {
  const { money, paper } = stats
  const decisiveMoney = money.wins + money.losses
  const decisivePaper = paper.wins + paper.losses
  const total = decisiveMoney + decisivePaper

  const data = [
    { name: 'Mit Geld', value: money.hitRate, n: decisiveMoney, fill: 'var(--positive)' },
    { name: 'Demo', value: paper.hitRate, n: decisivePaper, fill: 'var(--primary)' },
  ]

  return (
    <Card className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Target className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Trefferquote</h3>
          <p className="text-xs text-muted-foreground">Mit echtem Geld vs. Demo</p>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <Target className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Noch keine Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Schließe Trades ab, um die Trefferquote zu sehen.
          </p>
        </div>
      ) : (
        <ChartContainer
          config={{
            value: { label: 'Trefferquote' },
          }}
          className="aspect-auto h-[200px] w-full"
        >
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              className="font-mono text-[10px]"
            />
            <YAxis domain={[0, 100]} hide />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                className="fill-foreground font-mono text-xs font-semibold"
                formatter={(v) => `${Number(v).toFixed(0)}%`}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}

      <div className="mt-4 flex items-center justify-center gap-6">
        <Legend color="var(--positive)" label="Mit Geld" detail={`${decisiveMoney} Trades`} />
        <Legend color="var(--primary)" label="Demo" detail={`${decisivePaper} Trades`} />
      </div>
    </Card>
  )
}

function Legend({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-sm text-muted-foreground">
        {label} <span className="font-medium text-foreground">{detail}</span>
      </span>
    </div>
  )
}
