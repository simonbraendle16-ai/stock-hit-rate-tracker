'use client'

import { ChartContainer } from '@/components/ui/chart'
import { ChartEmpty, ChartHeader } from '@/components/chart-frame'
import { CHART_AXIS, CHART_MOTION } from '@/lib/chart-theme'
import { Bar, BarChart, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts'
import { Target, TrendingUp } from 'lucide-react'
import type { PortfolioGroup } from '@/app/actions/trades'
import { normalizePortfolioKind } from '@/lib/portfolio-scope'

// Nachfolger von `money-hitrate-chart` und `money-profit-chart` (Etappe 12).
//
// Vorher standen hier zwei feste Balken: „Mit Geld" und „Demo". Das war die
// einzige Trennung, die es gab. Mit echten Depots ist die interessante Frage
// eine andere — wie schlägt sich Broker A gegen Broker B, und das Übungsdepot
// gegen beide? Deshalb ist jeder Balken jetzt ein Depot.
//
// Dieser Block schaut bewusst über die aktive Auswahl hinweg (Vergleichen ist
// sein Zweck). Das ist kein Rückfall in den alten Fehler: Jeder Balken trägt
// seinen Namen, Demo-Depots sind gekennzeichnet, und nichts wird zu einer
// einzigen Zahl vermischt.

/** Demo-Depots bekommen den Akzentton, Echtgeld die Ergebnisfarben. */
const DEMO_COLOR = 'var(--warning)'

function istDemo(g: PortfolioGroup): boolean {
  return normalizePortfolioKind(g.kind) === 'demo'
}

/** Nur Depots zeigen, die überhaupt etwas Entschiedenes tragen. */
function mitDaten(groups: PortfolioGroup[]) {
  return groups
    .map((g) => ({ g, decisive: g.stats.wins + g.stats.losses }))
    .filter((x) => x.decisive > 0)
}

function Label({ groups }: { groups: PortfolioGroup[] }) {
  const demos = groups.filter(istDemo).length
  return (
    <p className="note mt-3 text-center">
      Ein Balken je Depot.{' '}
      {demos > 0
        ? 'Übungsdepots sind in Gold — ihre Zahlen zählen in keine Echtgeld-Kennzahl.'
        : 'Alle gezeigten Depots handeln mit echtem Geld.'}
    </p>
  )
}

export function PortfolioHitRateChart({ groups }: { groups: PortfolioGroup[] }) {
  const rows = mitDaten(groups)

  const data = rows.map(({ g, decisive }) => ({
    name: g.archived ? `${g.name} (Archiv)` : g.name,
    value: g.stats.hitRate,
    n: decisive,
    fill: istDemo(g) ? DEMO_COLOR : 'var(--positive)',
  }))

  return (
    <div className="panel sheen flex h-full flex-col p-4 sm:p-6">
      <ChartHeader icon={Target} title="Trefferquote" subtitle="Je Depot" />

      {data.length === 0 ? (
        <ChartEmpty
          icon={Target}
          className="flex-1 py-10"
          title="Noch keine Daten"
          hint="Schließe Trades ab, um die Trefferquote je Depot zu sehen."
        />
      ) : (
        <>
          <ChartContainer
            config={{ value: { label: 'Trefferquote' } }}
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

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {data.map((d) => (
              <Legend key={d.name} color={d.fill} label={d.name} detail={`${d.n} Trades`} />
            ))}
          </div>
          <Label groups={rows.map((r) => r.g)} />
        </>
      )}
    </div>
  )
}

const fmt = (v: number) =>
  `${v >= 0 ? '+' : ''}${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`

export function PortfolioProfitChart({ groups }: { groups: PortfolioGroup[] }) {
  const rows = mitDaten(groups)

  const data = rows.map(({ g, decisive }) => ({
    name: g.archived ? `${g.name} (Archiv)` : g.name,
    value: g.stats.avgPnL,
    total: g.stats.totalPnL,
    n: decisive,
    demo: istDemo(g),
  }))

  // Bei Echtgeld färbt das Ergebnis (grün/rot). Ein Übungsdepot bleibt Gold —
  // ein strahlend grüner Papier-Gewinn wäre genau die Verwechslung, die diese
  // Etappe verhindern soll.
  const color = (d: (typeof data)[number]) =>
    d.demo ? DEMO_COLOR : d.value >= 0 ? 'var(--positive)' : 'var(--destructive)'

  return (
    <div className="panel sheen flex h-full flex-col p-4 sm:p-6">
      <ChartHeader icon={TrendingUp} title="Ø Gewinn pro Trade" subtitle="Je Depot" />

      {data.length === 0 ? (
        <ChartEmpty
          icon={TrendingUp}
          className="flex-1 py-10"
          title="Noch keine Daten"
          hint="Schließe Trades ab, um den Ø Gewinn je Depot zu sehen."
        />
      ) : (
        <>
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
                  <Cell key={d.name} fill={color(d)} />
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

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] text-muted-foreground">
            {data.map((d) => (
              <span key={d.name}>
                {d.name} gesamt:{' '}
                <span
                  className={
                    d.demo
                      ? 'text-[var(--warning)]'
                      : d.total >= 0
                        ? 'text-positive'
                        : 'text-destructive'
                  }
                >
                  {fmt(d.total)}
                </span>
              </span>
            ))}
          </div>
          <Label groups={rows.map((r) => r.g)} />
        </>
      )}
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
