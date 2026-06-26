'use client'

import { Card } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import type { TimelinePoint } from '@/app/actions/stocks'
import { LineChart } from 'lucide-react'

export function HitRateTimeline({ data }: { data: TimelinePoint[] }) {
  const chartData = data.map((p, i) => ({
    index: i + 1,
    label: p.label,
    hitRate: Number(p.hitRate.toFixed(1)),
  }))

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <LineChart className="size-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Trefferquote im Verlauf
          </h3>
          <p className="text-xs text-muted-foreground">
            Kumulierte Quote über alle Einschätzungen
          </p>
        </div>
      </div>

      {chartData.length === 0 ? (
        <EmptyState />
      ) : (
        <ChartContainer
          config={{
            hitRate: { label: 'Trefferquote', color: 'var(--chart-1)' },
          }}
          className="h-[280px] w-full"
        >
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="fillHitRate" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-hitRate)"
                  stopOpacity={0.25}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-hitRate)"
                  stopOpacity={0.02}
                />
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
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={40}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <ReferenceLine
              y={50}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => [`${value}%`, ' Trefferquote']}
                  labelFormatter={(label) => `Datum: ${label}`}
                />
              }
            />
            <Area
              dataKey="hitRate"
              type="monotone"
              stroke="var(--color-hitRate)"
              strokeWidth={2}
              fill="url(#fillHitRate)"
              dot={chartData.length <= 30}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
      <LineChart className="size-8 text-muted-foreground/40" />
      <p className="mt-3 text-sm font-medium text-foreground">
        Noch keine Daten
      </p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Sobald du Einschätzungen erfasst, erscheint hier der Verlauf deiner
        Trefferquote.
      </p>
    </div>
  )
}
