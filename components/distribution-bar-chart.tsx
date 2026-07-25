'use client'

import { ChartContainer } from '@/components/ui/chart'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import { CHART_AXIS, CHART_MOTION } from '@/lib/chart-theme'
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { BarChart3 } from 'lucide-react'

export function DistributionBarChart({
  correct,
  wrong,
}: {
  correct: number
  wrong: number
}) {
  const total = correct + wrong
  const data = [
    { name: 'Richtig', value: correct, fill: 'var(--positive)' },
    { name: 'Falsch', value: wrong, fill: 'var(--negative)' },
  ]

  return (
    <div className="panel sheen flex h-full flex-col p-4 sm:p-6">
      <ChartHeader
        icon={BarChart3}
        title="Richtig / Falsch"
        subtitle="Anzahl im Vergleich"
      />

      {total === 0 ? (
        <ChartEmpty
          icon={BarChart3}
          className="flex-1 py-10"
          title="Noch keine Daten"
          hint="Erfasse Einschätzungen, um die Verteilung zu sehen."
        />
      ) : (
        <ChartContainer
          config={{ value: { label: 'Anzahl' } }}
          className="aspect-square mx-auto max-h-[200px] w-full"
        >
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis dataKey="name" {...CHART_AXIS} />
            <YAxis hide allowDecimals={false} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90} {...CHART_MOTION}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                className="fill-foreground font-mono text-xs font-semibold"
                formatter={(v) => `${Number(v)}`}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}

      <div className="mt-4 flex items-center justify-center gap-6">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-positive" />
          <span className="text-sm text-muted-foreground">
            Richtig <span className="font-medium text-foreground">{correct}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-negative" />
          <span className="text-sm text-muted-foreground">
            Falsch <span className="font-medium text-foreground">{wrong}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
