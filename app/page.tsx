import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  getOverallStats,
  getStocksWithStats,
  getHitRateTimeline,
} from '@/app/actions/stocks'
import { SignOutButton } from '@/components/sign-out-button'
import { StatCards } from '@/components/stat-cards'
import { DistributionChart } from '@/components/distribution-chart'
import { HitRateTimeline } from '@/components/hitrate-timeline'
import { StockRanking } from '@/components/stock-ranking'
import { AddStockDialog } from '@/components/add-stock-dialog'
import { TrendingUp } from 'lucide-react'

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [stats, stocks, timeline] = await Promise.all([
    getOverallStats(),
    getStocksWithStats(),
    getHitRateTimeline(),
  ])

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight text-foreground font-heading">
                Trefferquote
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                Aktienanalyse-Bilanz
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.name || session.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-balance text-xl font-semibold tracking-tight text-foreground font-heading sm:text-2xl">
              Übersicht
            </h2>
            <p className="text-pretty text-sm text-muted-foreground">
              Deine Analyse-Bilanz auf einen Blick.
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
