'use client'

import { Card } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
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
    <Card className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Richtig / Falsch</h3>
          <p className="text-xs text-muted-foreground">Anzahl im Vergleich</p>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <BarChart3 className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Noch keine Daten</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Erfasse Einschätzungen, um die Verteilung zu sehen.
          </p>
        </div>
      ) : (
        <ChartContainer
          config={{ value: { label: 'Anzahl' } }}
          className="aspect-square mx-auto max-h-[200px] w-full"
        >
          <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              className="font-mono text-[10px]"
            />
            <YAxis hide allowDecimals={false} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={90}>
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
    </Card>
  )
}
