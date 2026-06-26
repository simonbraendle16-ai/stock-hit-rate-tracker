import { Card } from '@/components/ui/card'
import type { OverallStats } from '@/app/actions/stocks'
import { Target, CheckCircle2, XCircle, Layers } from 'lucide-react'

export function StatCards({ stats }: { stats: OverallStats }) {
  const hitRate = stats.total > 0 ? stats.hitRate.toFixed(1) : '–'

  const items = [
    {
      label: 'Trefferquote gesamt',
      value: stats.total > 0 ? `${hitRate}%` : '–',
      icon: Target,
      accent: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Richtig',
      value: stats.correct.toString(),
      icon: CheckCircle2,
      accent: 'text-positive',
      bg: 'bg-positive/10',
    },
    {
      label: 'Falsch',
      value: stats.wrong.toString(),
      icon: XCircle,
      accent: 'text-negative',
      bg: 'bg-negative/10',
    },
    {
      label: 'Aktien getrackt',
      value: stats.stockCount.toString(),
      icon: Layers,
      accent: 'text-foreground',
      bg: 'bg-muted',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.bg}`}
            >
              <item.icon className={`size-5 ${item.accent}`} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {item.label}
              </p>
              <p
                className={`text-xl font-semibold tracking-tight sm:text-2xl ${item.accent}`}
              >
                {item.value}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
