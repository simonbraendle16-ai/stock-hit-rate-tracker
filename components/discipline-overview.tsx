import type { DisciplineStats } from '@/app/actions/trades'
import { cn } from '@/lib/utils'
import { Flame, Target, TrendingUp, ShieldAlert } from 'lucide-react'

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

/** The discipline score gets the one bold-contrast treatment in the app. */
export function DisciplineBar({ stats }: { stats: DisciplineStats }) {
  const v = Math.round(stats.disciplineScore)
  const color = scoreColor(stats.disciplineScore)
  return (
    <div className="glass-card p-5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Disziplin-Score
      </p>
      <div className="mt-1 flex items-end gap-3">
        <span className={cn('font-heading text-5xl font-bold leading-none', color)}>
          {v}%
        </span>
        <span className="mb-1 font-mono text-[11px] text-muted-foreground">
          {stats.completed} abgeschlossene Trades · Plan befolgt
        </span>
      </div>
      <div className="bar-track mt-3 h-3">
        <div
          className={cn('bar-glow h-full rounded-full bg-current transition-all', color)}
          style={{ width: `${Math.max(2, v)}%` }}
        />
      </div>
      {stats.ruleViolations > 0 && (
        <p className="mt-2 flex items-center gap-1 font-mono text-[11px] text-destructive">
          <ShieldAlert className="size-3" /> {stats.ruleViolations} protokollierte Regelbrüche
        </p>
      )}
    </div>
  )
}

export function CockpitStats({ stats }: { stats: DisciplineStats }) {
  const cards = [
    {
      label: 'Gewinnquote',
      value: `${Math.round(stats.winRate)}%`,
      icon: Target,
      tone: winRateColor(stats.winRate),
    },
    {
      label: 'Erwartungswert',
      value: `${stats.expectancy >= 0 ? '+' : ''}${stats.expectancy.toFixed(2)}R`,
      icon: TrendingUp,
      tone: stats.expectancy >= 0 ? 'text-positive' : 'text-destructive',
    },
    {
      label: 'Plan-Streak',
      value: `×${stats.streak}`,
      icon: Flame,
      tone: 'text-primary',
    },
    {
      label: 'Bilanz',
      value: `${stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(0)}`,
      sub: `${stats.returnPct >= 0 ? '+' : ''}${stats.returnPct.toFixed(1)}%`,
      icon: TrendingUp,
      tone: stats.totalPnL >= 0 ? 'text-positive' : 'text-destructive',
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="glass-card p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {c.label}
            </p>
            <c.icon className={cn('size-4', c.tone)} />
          </div>
          <p className={cn('mt-2 font-heading text-2xl font-bold', c.tone)}>{c.value}</p>
          {c.sub && <p className="font-mono text-[11px] text-muted-foreground">{c.sub}</p>}
        </div>
      ))}
    </div>
  )
}

export function FiveBeliefs() {
  const beliefs = [
    'Jeder Trade ist einzigartig.',
    'Du weißt nie, was als Nächstes passiert.',
    'Du brauchst es nicht zu wissen, um Geld zu verdienen.',
    'Eine Serie von Verlusten ist normal.',
    'Langfristig zählt nur der Erwartungswert.',
  ]
  return (
    <div className="glass-card p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        Die 5 Grundüberzeugungen
      </p>
      <ol className="mt-3 space-y-1.5">
        {beliefs.map((b, i) => (
          <li key={b} className="flex gap-2 font-mono text-xs text-muted-foreground">
            <span className="text-primary">{i + 1}.</span> {b}
          </li>
        ))}
      </ol>
    </div>
  )
}
