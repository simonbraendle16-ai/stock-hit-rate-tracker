'use client'

import { Card } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Cell, Label, Pie, PieChart } from 'recharts'
import { PieChart as PieIcon } from 'lucide-react'

export function DistributionChart({
  correct,
  wrong,
}: {
  correct: number
  wrong: number
}) {
  const total = correct + wrong
  const data = [
    { name: 'Richtig', value: correct, fill: 'var(--color-positive)' },
    { name: 'Falsch', value: wrong, fill: 'var(--color-negative)' },
  ]

  return (
    <Card className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <PieIcon className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Richtig / Falsch
          </h3>
          <p className="text-xs text-muted-foreground">Gesamtverteilung</p>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <PieIcon className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Noch keine Daten
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Erfasse Einschätzungen, um die Verteilung zu sehen.
          </p>
        </div>
      ) : (
        <>
          <ChartContainer
            config={{
              Richtig: { label: 'Richtig', color: 'var(--positive)' },
              Falsch: { label: 'Falsch', color: 'var(--negative)' },
            }}
            className="mx-auto aspect-square max-h-[200px]"
          >
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={58}
                outerRadius={80}
                strokeWidth={2}
                stroke="var(--card)"
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !('cx' in viewBox)) return null
                    const rate = total > 0 ? (correct / total) * 100 : 0
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) - 4}
                          className="fill-foreground text-2xl font-semibold"
                        >
                          {rate.toFixed(0)}%
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 16}
                          className="fill-muted-foreground text-xs"
                        >
                          richtig
                        </tspan>
                      </text>
                    )
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>

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
        </>
      )}
    </Card>
  )
}
