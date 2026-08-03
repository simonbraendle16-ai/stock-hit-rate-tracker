import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CockpitHeader } from '@/components/cockpit-header'
import { TrainingStatsPanel } from '@/components/trainer/training-stats-panel'
import { getTrainingStats } from '@/app/actions/training'
import { ArrowLeft } from 'lucide-react'

export default async function TrainingStatsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const stats = await getTrainingStats()

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/trainer"
          className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Zurück zum Trainer
        </Link>

        <div className="mb-6">
          <p className="eyebrow">Trainingsstatistik</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Was die Übungen über deine Analyse sagen
          </h2>
          <p className="note mt-1.5">
            Getrennt von den echten Trades auf der Auswertung — eine Übungsquote ist keine
            Handelsbilanz.
          </p>
        </div>

        <TrainingStatsPanel stats={stats} />
      </main>
    </div>
  )
}
