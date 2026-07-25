'use client'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import type { TimelinePoint } from '@/app/actions/stocks'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import { CountUp } from '@/components/count-up'
import {
  AREA_FILL,
  CHART_AXIS,
  CHART_GRID,
  CHART_MOTION,
  CHART_REFERENCE,
} from '@/lib/chart-theme'
import { LineChart } from 'lucide-react'

export function HitRateTimeline({ data }: { data: TimelinePoint[] }) {
  const chartData = data.map((p, i) => ({
    index: i + 1,
    label: p.label,
    hitRate: Number(p.hitRate.toFixed(1)),
  }))

  // Der aktuelle Stand gehört in den Kopf: die Kurve zeigt die Entwicklung,
  // die Zahl den Punkt, an dem man heute steht.
  const current = chartData.length > 0 ? chartData[chartData.length - 1].hitRate : null

  return (
    <div className="panel sheen p-4 sm:p-6">
      <ChartHeader
        icon={LineChart}
        title="Trefferquote im Verlauf"
        subtitle="Kumulierte Quote über alle Einschätzungen"
        right={
          current != null ? (
            <p className="metric metric-lg text-primary">
              <CountUp value={current} format={(v) => v.toFixed(0)} />
              <span className="note ml-0.5">%</span>
            </p>
          ) : undefined
        }
      />

      {chartData.length === 0 ? (
        <ChartEmpty
          icon={LineChart}
          title="Noch keine Daten"
          hint="Sobald du Einschätzungen erfasst, erscheint hier der Verlauf deiner Trefferquote."
        />
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
                  stopOpacity={AREA_FILL.top}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-hitRate)"
                  stopOpacity={AREA_FILL.bottom}
                />
              </linearGradient>
            </defs>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="label" minTickGap={24} {...CHART_AXIS} />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              width={40}
              tickFormatter={(v) => `${v}%`}
              {...CHART_AXIS}
            />
            <ReferenceLine y={50} {...CHART_REFERENCE} />
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
              {...CHART_MOTION}
            />
            {/* „Hier stehst du heute." Bewusst ohne Puls: pulsen darf nur, was
                auf etwas wartet (offene Alerts) — eine Kennzahl tut das nicht. */}
            {current != null && (
              <ReferenceDot
                x={chartData.length}
                y={current}
                r={4}
                className="svg-glow text-primary"
                fill="var(--color-hitRate)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}
