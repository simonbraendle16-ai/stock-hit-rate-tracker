'use client'

// Die Doppelkurve des Bot-Zwillings (Etappe 5): mechanischer Plan gegen
// tatsächliches Handeln, beide kumuliert in R über dieselben Trades.
//
// Beide Kurven starten bei 0 R — nur dann ist die Schere zwischen ihnen exakt
// die Differenz, um die es geht. Bewusst in R und nicht in Geld: der Vergleich
// soll von Positionsgröße und Währung unabhängig bleiben, und Geldbeträge
// rücken das Ergebnis vor den Prozess.

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { CHART_AXIS, CHART_GRID, CHART_MOTION, CHART_REFERENCE } from '@/lib/chart-theme'

export function BotTwinCurve({
  points,
}: {
  points: { label: string; bot: number; real: number }[]
}) {
  const rTick = (v: number) =>
    `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('de-DE', {
      maximumFractionDigits: 1,
    })} R`

  return (
    <ChartContainer
      config={{
        // Neutrales Grau für den Bot: er ist die Referenzlinie, nicht das
        // Ergebnis. Gold (--chart-4) wäre hier falsch — dieselbe Farbe trägt in
        // der App die Warnung.
        bot: { label: 'Plan mechanisch', color: 'var(--chart-5)' },
        real: { label: 'Tatsächlich', color: 'var(--chart-1)' },
      }}
      className="h-[240px] w-full"
    >
      <LineChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="label" minTickGap={24} {...CHART_AXIS} />
        <YAxis width={64} tickFormatter={(v) => rTick(Number(v))} domain={['auto', 'auto']} {...CHART_AXIS} />
        <ReferenceLine y={0} {...CHART_REFERENCE} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => [
                rTick(Number(value)),
                name === 'bot' ? ' Plan mechanisch' : ' Tatsächlich',
              ]}
              labelFormatter={(label) => `Abschluss: ${label}`}
            />
          }
        />
        {/* Der Bot liegt hinten und gestrichelt: er ist die Referenz, nicht das
            Ergebnis. Vorn und durchgezogen steht, was tatsächlich passiert ist. */}
        <Line
          dataKey="bot"
          type="monotone"
          stroke="var(--color-bot)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          activeDot={{ r: 4 }}
          {...CHART_MOTION}
        />
        <Line
          dataKey="real"
          type="monotone"
          stroke="var(--color-real)"
          strokeWidth={2}
          dot={points.length <= 30}
          activeDot={{ r: 4 }}
          {...CHART_MOTION}
        />
      </LineChart>
    </ChartContainer>
  )
}
