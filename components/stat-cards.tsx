import type { OverallStats } from '@/app/actions/stocks'
import { CountUp } from '@/components/count-up'
import { cn } from '@/lib/utils'

/**
 * Die Kennzahlen der Analyse-Seite — dasselbe Ableseband wie im Cockpit
 * (`CockpitStats`), damit beide Seiten dieselbe Sprache sprechen. Vorher waren
 * es vier einzelne Karten mit Icon-Kacheln, die optisch aus der App fielen.
 *
 * Formatierung über serialisierbare Props: Diese Komponente rendert auf dem
 * Server, `CountUp` ist ein Client-Teil.
 */
export function StatCards({ stats }: { stats: OverallStats }) {
  const hasData = stats.total > 0

  const readouts: {
    label: string
    num: number
    decimals?: number
    suffix?: string
    tone: string
  }[] = [
    {
      label: 'Trefferquote gesamt',
      num: stats.hitRate,
      decimals: 1,
      suffix: '%',
      tone: 'text-primary',
    },
    { label: 'Richtig', num: stats.correct, tone: 'text-positive' },
    { label: 'Falsch', num: stats.wrong, tone: 'text-negative' },
    { label: 'Aktien getrackt', num: stats.stockCount, tone: 'text-foreground' },
  ]

  return (
    <div className="panel sheen rise-in grid grid-cols-2 overflow-hidden sm:grid-cols-4">
      {readouts.map((r, i) => (
        <div
          key={r.label}
          className={cn(
            'px-5 py-4',
            i >= 2 && 'border-t border-border sm:border-t-0',
            i % 2 === 1 && 'border-l border-border',
            i % 2 === 0 && i > 0 && 'sm:border-l sm:border-border',
          )}
        >
          <p className="eyebrow">{r.label}</p>
          <p className={cn('metric metric-lg mt-2', r.tone)}>
            {/* Ohne eine einzige Einschätzung gibt es keine Quote — dann ein
                Strich statt einer 0,0 %, die eine Messung behaupten würde. */}
            {i === 0 && !hasData ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <CountUp value={r.num} decimals={r.decimals ?? 0} suffix={r.suffix ?? ''} />
            )}
          </p>
          <span
            className={cn('bar-fill mt-3 block h-0.5 rounded-full bg-current opacity-45', r.tone)}
          />
        </div>
      ))}
    </div>
  )
}
