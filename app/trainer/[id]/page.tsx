import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { CockpitHeader } from '@/components/cockpit-header'
import { TrainingWorkspace } from '@/components/trainer/training-workspace'
import { getTrainingSession } from '@/app/actions/training'
import { listSessionTrades } from '@/app/actions/training-trades'
import { TRAINING_MODES } from '@/lib/training'
import { ArrowLeft } from 'lucide-react'

export default async function TrainingSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth_session = await auth.api.getSession({ headers: await headers() })
  if (!auth_session?.user) redirect('/sign-in')

  const { id } = await params
  const sessionId = Number(id)
  if (!Number.isInteger(sessionId)) notFound()

  const data = await getTrainingSession(sessionId)
  if (!data) notFound()

  // Die geübten Trades dieser Sitzung (Migration 0029). Bei Übungen aus der
  // Zeit davor ist die Liste leer — sie laufen weiter im alten Ablauf.
  const trades = await listSessionTrades(sessionId)

  const modus = TRAINING_MODES.find((m) => m.id === data.session.mode)

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={auth_session.user.name || auth_session.user.email} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/trainer"
          className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Zurück zum Trainer
        </Link>

        <div className="mb-5">
          <p className="eyebrow">{modus?.label ?? 'Übung'}</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground">
            {data.session.symbol ?? 'Verdecktes Instrument'}
            <span className="ml-2 font-mono text-base text-muted-foreground">
              {data.session.timeframe}
            </span>
          </h2>
          <p className="note mt-1.5">{modus?.hint}</p>
        </div>

        <TrainingWorkspace
          session={data.session}
          annotations={data.annotations}
          result={data.result}
          initialTrades={trades}
        />
      </main>
    </div>
  )
}
