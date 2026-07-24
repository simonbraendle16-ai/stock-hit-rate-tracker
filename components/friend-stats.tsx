// Betragsfreie Disziplin-Kennzahlen eines Freundes als Chip-Reihe. Rein
// präsentational, auf /friends (Liste) und /friends/[id] (Detail) wiederverwendet.
// Zeigt bewusst nur größenunabhängige Zahlen — nie einen Betrag.

import type { FriendSummary } from '@/lib/friends'
import { cn } from '@/lib/utils'
import { Flame, Target, TrendingUp, ShieldAlert, ShieldCheck } from 'lucide-react'

function scoreColor(v: number) {
  if (v >= 80) return 'text-positive'
  if (v >= 50) return 'text-warning'
  return 'text-destructive'
}

// Wie im Cockpit: mit gutem CRV ist eine Quote um 50 % bereits stark.
function winRateColor(v: number) {
  if (v >= 50) return 'text-positive'
  if (v >= 40) return 'text-warning'
  return 'text-destructive'
}

export function FriendStats({ summary }: { summary: FriendSummary }) {
  const cards = [
    {
      label: 'Disziplin',
      value: `${Math.round(summary.disciplineScore)}%`,
      icon: ShieldCheck,
      tone: scoreColor(summary.disciplineScore),
    },
    {
      label: 'Gewinnquote',
      value: `${Math.round(summary.winRate)}%`,
      icon: Target,
      tone: winRateColor(summary.winRate),
    },
    {
      label: 'Erwartungswert',
      value: `${summary.expectancy >= 0 ? '+' : ''}${summary.expectancy.toFixed(2)}R`,
      icon: TrendingUp,
      tone: summary.expectancy >= 0 ? 'text-positive' : 'text-destructive',
    },
    {
      label: 'Plan-Streak',
      value: `×${summary.streak}`,
      icon: Flame,
      tone: 'text-primary',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              {c.label}
            </p>
            <c.icon className={cn('size-3.5', c.tone)} />
          </div>
          <p className={cn('mt-1 font-heading text-xl font-bold', c.tone)}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

/** Kompakte Regelbruch-Zeile — der passive Accountability-Hinweis. */
export function RuleViolationLine({ summary }: { summary: FriendSummary }) {
  if (summary.ruleViolations > 0) {
    return (
      <p className="flex items-center gap-1.5 font-mono text-[11px] text-destructive">
        <ShieldAlert className="size-3.5" />
        {summary.ruleViolations} protokollierte{' '}
        {summary.ruleViolations === 1 ? 'Regelbruch' : 'Regelbrüche'} ·{' '}
        {summary.completed} abgeschlossene Trades
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      <ShieldCheck className="size-3.5 text-positive" />
      Keine protokollierten Regelbrüche · {summary.completed} abgeschlossene Trades
    </p>
  )
}
