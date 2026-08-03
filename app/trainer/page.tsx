import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CockpitHeader } from '@/components/cockpit-header'
import { TrainerStart } from '@/components/trainer/trainer-start'
import { TrainingHistory } from '@/components/trainer/training-history'
import {
  listTrainingSessions,
  getTrainingStats,
  getTrainingCoverage,
} from '@/app/actions/training'
import { MIN_TRAINING_RUNS } from '@/lib/training-stats'
import { BarChart3, Clapperboard } from 'lucide-react'

export default async function TrainerPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; market?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const params = await searchParams
  const [sessions, stats, coverage] = await Promise.all([
    listTrainingSessions(15),
    getTrainingStats(),
    getTrainingCoverage(),
  ])

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Replay-Trainer</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Charts zurückspulen und die eigene These messen
            </h2>
            <p className="note mt-1.5">
              Analyse festschreiben, Kerze für Kerze aufdecken, ehrlich bewerten. Die Übung
              zählt nur, wenn die These vor dem Ergebnis stand.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/trainer/frei"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-primary"
            >
              <Clapperboard className="size-3.5" />
              Freies Replay
            </Link>
            <Link
              href="/trainer/statistik"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-primary"
            >
              <BarChart3 className="size-3.5" />
              Trainingsstatistik
              {stats.overall.quote != null
                ? ` · ${stats.overall.quote.toFixed(0)} %`
                : ` · ${stats.rated} von ${MIN_TRAINING_RUNS}`}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TrainerStart
              initialSymbol={(params.symbol ?? '').toUpperCase()}
              initialMarket={params.market ?? 'aktien'}
              coverage={coverage}
            />
          </div>
          <div className="lg:col-span-2">
            <TrainingHistory sessions={sessions} />
          </div>
        </div>
      </main>
    </div>
  )
}
