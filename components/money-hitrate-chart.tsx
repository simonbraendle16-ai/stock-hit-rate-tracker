'use client'

import { ChartContainer } from '@/components/ui/chart'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import { CHART_AXIS, CHART_MOTION } from '@/lib/chart-theme'
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
    <div className="panel sheen flex h-full flex-col p-4 sm:p-6">
      <ChartHeader
        icon={Target}
        title="Trefferquote"
        subtitle="Mit echtem Geld vs. Demo"
      />

      {total === 0 ? (
        <ChartEmpty
          icon={Target}
          className="flex-1 py-10"
          title="Noch keine Daten"
          hint="Schließe Trades ab, um die Trefferquote zu sehen."
        />
      ) : (
        <ChartContainer
          config={{
            value: { label: 'Trefferquote' },
          }}
          className="aspect-auto h-[200px] w-full"
        >
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="name" {...CHART_AXIS} />
            <YAxis domain={[0, 100]} hide />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90} {...CHART_MOTION}>
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
    </div>
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
