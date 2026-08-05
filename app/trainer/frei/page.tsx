import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CockpitHeader } from '@/components/cockpit-header'
import { TrainerChart } from '@/components/chart/trainer-chart'
import { ArrowLeft } from 'lucide-react'

/**
 * Freies Replay ohne Bewertung — der Prototyp aus Phase 1 des Trainer-Plans.
 *
 * Er bleibt bewusst erhalten: Nicht jedes Zurückspulen ist eine Übung. Wer nur
 * nachsehen will, wie eine Bewegung entstanden ist, soll das tun können, ohne
 * eine These festzuschreiben. Gemessen wird nur unter `/trainer`.
 */
export default async function FreiesReplayPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string; market?: string; timeframe?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const params = await searchParams
  const symbol = (params.symbol ?? 'AAPL').trim().toUpperCase()
  const market = params.market ?? 'aktien'
  const timeframe = params.timeframe ?? '1h'

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      {/* Dieselbe Begründung wie beim gemessenen Trainer: Das freie Replay ist
          eine Arbeitsfläche, keine Textseite. */}
      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/trainer"
          className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Zurück zum Trainer
        </Link>

        <div className="mb-6">
          <p className="eyebrow">Freies Replay</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Zurückspulen, ohne dass es zählt
          </h2>
          <p className="note mt-1.5">
            Beliebiges Symbol, versteckte Zukunft, keine Bewertung und keine Speicherung.
            Für die gemessene Übung geht es über den Trainer.
          </p>
        </div>

        <TrainerChart initialSymbol={symbol} initialMarket={market} initialTimeframe={timeframe} />
      </main>
    </div>
  )
}
