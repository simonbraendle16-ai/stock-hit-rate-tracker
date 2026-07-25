import type { DisciplineStats } from '@/lib/trade-stats'
import { cn } from '@/lib/utils'
import { CountUp } from '@/components/count-up'
import { DisciplineRing } from '@/components/discipline-ring'
import { ShieldAlert } from 'lucide-react'

function scoreColor(v: number) {
  if (v >= 80) return 'text-positive'
  if (v >= 50) return 'text-warning'
  return 'text-destructive'
}

// Win-Rate wird anders bewertet als Disziplin: mit gutem CRV ist eine Quote
// um 50 % bereits stark, deshalb hier realistischere Schwellen.
function winRateColor(v: number) {
  if (v >= 50) return 'text-positive'
  if (v >= 40) return 'text-warning'
  return 'text-destructive'
}

/**
 * Die Hero-Kennzahl der App. Es gibt bewusst nur EINE große Zahl — und es ist
 * der Disziplin-Score, nicht die Gewinnquote: gemessen wird Plan-Treue, nicht
 * Ergebnis (Douglas-Leitplanke aus CLAUDE.md).
 *
 * Der Ring hat den früheren Balken abgelöst; die Atmosphäre dahinter ist die
 * einzige Dauerbewegung auf dieser Fläche und bewusst kontrastarm.
 */
export function DisciplineBar({ stats }: { stats: DisciplineStats }) {
  const color = scoreColor(stats.disciplineScore)
  const hasData = stats.completed > 0

  return (
    <div className="panel-raised sheen rise-in relative flex h-full items-center gap-6 p-5 sm:gap-8 sm:p-6">
      <div className="hero-atmo" aria-hidden="true">
        <div className="hero-scan" />
      </div>

      <DisciplineRing
        value={stats.disciplineScore}
        colorClass={color}
        hasData={hasData}
        className="relative size-36 sm:size-44"
      />

      <div className="relative min-w-0 flex-1">
        <p className="eyebrow">Disziplin-Score</p>
        <p className="mt-2 text-sm text-foreground">
          {hasData
            ? `${stats.completed} abgeschlossene Trades · Plan befolgt`
            : 'Noch kein Score — er entsteht mit dem ersten abgeschlossenen Trade.'}
        </p>
        {stats.ruleViolations > 0 && (
          <p className="mt-2.5 flex items-center gap-1.5 font-mono text-[11px] text-destructive">
            <ShieldAlert className="size-3.5" /> {stats.ruleViolations} protokollierte
            Regelbrüche
          </p>
        )}
        <p className="note mt-4 border-t border-border pt-3">
          Der Score misst Plan-Treue, nicht Gewinn. Ein guter Trade ist ein plan-konformer
          Trade — unabhängig vom Ausgang.
        </p>
      </div>
    </div>
  )
}

/**
 * Die Nebenkennzahlen als ein zusammenhängendes Ableseband statt vier
 * konkurrierender Karten — dadurch bleibt die Hierarchie eindeutig.
 *
 * Die Linie unter jeder Zahl läuft beim Mount voll ein. Sie ist bewusst
 * **nicht** proportional: eine anteilig gefüllte Spur würde bei Kennzahlen wie
 * dem Erwartungswert eine Skala behaupten, die es nicht gibt.
 */
export function CockpitStats({ stats }: { stats: DisciplineStats }) {
  // Formatierung über serialisierbare Props statt einer format-Funktion: diese
  // Komponente rendert auf dem Server, CountUp ist ein Client-Teil — Funktionen
  // lassen sich über diese Grenze nicht reichen.
  const readouts: {
    label: string
    num: number
    decimals?: number
    prefix?: string
    suffix?: string
    signed?: boolean
    sub?: string
    tone: string
  }[] = [
    {
      label: 'Gewinnquote',
      num: stats.winRate,
      suffix: '%',
      tone: winRateColor(stats.winRate),
    },
    {
      label: 'Erwartungswert',
      num: stats.expectancy,
      decimals: 2,
      suffix: 'R',
      signed: true,
      tone: stats.expectancy >= 0 ? 'text-positive' : 'text-destructive',
    },
    {
      label: 'Plan-Streak',
      num: stats.streak,
      prefix: '×',
      tone: 'text-primary',
    },
    {
      label: 'Bilanz',
      num: stats.totalPnL,
      signed: true,
      sub: `${stats.returnPct >= 0 ? '+' : ''}${stats.returnPct.toFixed(1)}%`,
      tone: stats.totalPnL >= 0 ? 'text-positive' : 'text-destructive',
    },
  ]
  return (
    <div className="panel sheen rise-in rise-in-2 grid grid-cols-2 overflow-hidden sm:grid-cols-4">
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
            <CountUp
              value={r.num}
              decimals={r.decimals ?? 0}
              prefix={r.prefix ?? ''}
              suffix={r.suffix ?? ''}
              signed={r.signed ?? false}
            />
          </p>
          {r.sub && <p className="note mt-1">{r.sub}</p>}
          <span
            className={cn('bar-fill mt-3 block h-0.5 rounded-full bg-current opacity-45', r.tone)}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Die fünf Sätze bauen sich nacheinander auf, begleitet von einer Linie, die
 * an der Nummernspalte entlangläuft — der Kern der App soll sich lesen wie
 * etwas, das man durchgeht, nicht wie eine Aufzählung.
 */
export function FiveBeliefs() {
  const beliefs = [
    'Jeder Trade ist einzigartig.',
    'Du weißt nie, was als Nächstes passiert.',
    'Du brauchst es nicht zu wissen, um Geld zu verdienen.',
    'Eine Serie von Verlusten ist normal.',
    'Langfristig zählt nur der Erwartungswert.',
  ]
  return (
    <div className="panel sheen h-full p-4 sm:p-5">
      <p className="eyebrow text-primary/70">Die 5 Grundüberzeugungen</p>
      <ol className="relative mt-3.5 space-y-2">
        <span
          className="line-draw-y absolute bottom-1 left-0 top-1 w-px bg-primary/25"
          aria-hidden="true"
        />
        {beliefs.map((b, i) => (
          <li
            key={b}
            className="rise-in flex gap-2 pl-3 font-mono text-xs leading-relaxed text-muted-foreground"
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <span className="text-primary tabular">{i + 1}.</span> {b}
          </li>
        ))}
      </ol>
    </div>
  )
}
