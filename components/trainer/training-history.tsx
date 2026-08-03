import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { ChartHeader } from '@/components/chart-frame'
import { TRAINING_RATINGS, type TrainingRating, type TrainingStatus } from '@/lib/training'
import { History } from 'lucide-react'

const STATUS_LABEL: Record<TrainingStatus, string> = {
  offen: 'Analyse offen',
  festgeschrieben: 'These steht',
  bewertet: 'Bewertet',
  abgebrochen: 'Verworfen',
}

const RATING_CLASS: Record<TrainingRating, string> = {
  korrekt: 'text-positive',
  teilweise: 'text-warning',
  falsch: 'text-destructive',
}

/** Die letzten Übungen — offene stehen oben, damit keine liegen bleibt. */
export function TrainingHistory({
  sessions,
}: {
  sessions: {
    id: number
    symbol: string | null
    timeframe: string
    status: TrainingStatus
    rating: TrainingRating | null
    createdAt: Date
  }[]
}) {
  return (
    <section className="panel p-4">
      <ChartHeader
        icon={History}
        title="Zuletzt geübt"
        subtitle="Eine offene Übung bleibt offen, bis sie bewertet oder verworfen ist."
      />
      {sessions.length === 0 ? (
        <p className="note">Noch keine Übung. Die erste ist ein Klick.</p>
      ) : (
        <div className="divide-y divide-border">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/trainer/${s.id}`}
              className="flex items-center justify-between gap-3 py-2 font-mono text-xs hover:text-primary"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-bold text-foreground">{s.symbol ?? 'verdeckt'}</span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {s.timeframe}
                </Badge>
                <span className="truncate text-muted-foreground">
                  {s.createdAt.toLocaleDateString('de-DE')}
                </span>
              </span>
              <span className="shrink-0 uppercase tracking-widest text-muted-foreground">
                {s.rating ? (
                  <span className={RATING_CLASS[s.rating]}>
                    {TRAINING_RATINGS.find((r) => r.id === s.rating)!.label}
                  </span>
                ) : (
                  STATUS_LABEL[s.status]
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
