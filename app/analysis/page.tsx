import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  getOverallStats,
  getStocksWithStats,
  getHitRateTimeline,
} from '@/app/actions/stocks'
import { CockpitHeader } from '@/components/cockpit-header'
import { StatCards } from '@/components/stat-cards'
import { DistributionChart } from '@/components/distribution-chart'
import { HitRateTimeline } from '@/components/hitrate-timeline'
import { StockRanking } from '@/components/stock-ranking'
import { AddStockDialog } from '@/components/add-stock-dialog'

export default async function AnalysisPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [stats, stocks, timeline] = await Promise.all([
    getOverallStats(),
    getStocksWithStats(),
    getHitRateTimeline(),
  ])

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-bold tracking-widest text-foreground sm:text-2xl">
              ANALYSE
            </h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Reine Prognosen pro Instrument — richtig vs. falsch, ohne echtes Geld.
            </p>
          </div>
          <AddStockDialog />
        </div>

        <StatCards stats={stats} />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HitRateTimeline data={timeline} />
          </div>
          <div className="lg:col-span-1">
            <DistributionChart correct={stats.correct} wrong={stats.wrong} />
          </div>
        </div>

        <div className="mt-6">
          <StockRanking stocks={stocks} />
        </div>
      </main>
    </div>
  )
}
