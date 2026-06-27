import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getStockDetail } from '@/app/actions/stocks'
import { SignOutButton } from '@/components/sign-out-button'
import { DistributionChart } from '@/components/distribution-chart'
import { HitRateTimeline } from '@/components/hitrate-timeline'
import { AssessmentList } from '@/components/assessment-list'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, TrendingUp } from 'lucide-react'

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { id } = await params
  const stockId = Number(id)
  if (!Number.isInteger(stockId)) notFound()

  const detail = await getStockDetail(stockId)
  if (!detail) notFound()

  const hasData = detail.total > 0

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Zurück zur Übersicht"
            >
              <ArrowLeft className="size-5" />
            </Link>
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
            <div className="flex items-center gap-2">
              <h2 className="text-balance text-xl font-semibold tracking-tight text-foreground font-heading sm:text-2xl">
                {detail.name}
              </h2>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {detail.ticker}
              </Badge>
            </div>
            <p className="text-pretty text-sm text-muted-foreground">
              {hasData
                ? `${detail.hitRate.toFixed(0)}% Trefferquote über ${detail.total} Einschätzung${detail.total === 1 ? '' : 'en'}.`
                : 'Noch keine Einschätzungen erfasst.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HitRateTimeline data={detail.timeline} />
          </div>
          <div className="lg:col-span-1">
            <DistributionChart correct={detail.correct} wrong={detail.wrong} />
          </div>
        </div>

        <div className="mt-6">
          <AssessmentList
            stockId={detail.id}
            stockName={detail.name}
            assessments={detail.assessments}
          />
        </div>
      </main>
    </div>
  )
}
