import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getStockDetail } from '@/app/actions/stocks'
import { getInstrumentTrades } from '@/app/actions/trades'
import { CockpitHeader } from '@/components/cockpit-header'
import { DistributionChart } from '@/components/distribution-chart'
import { HitRateTimeline } from '@/components/hitrate-timeline'
import { AssessmentList } from '@/components/assessment-list'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from 'lucide-react'

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

  const [detail, trades] = await Promise.all([
    getStockDetail(stockId),
    getInstrumentTrades(stockId),
  ])
  if (!detail) notFound()

  const hasData = detail.total > 0

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/analysis"
          className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Zurück zur Analyse
        </Link>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-xl font-bold tracking-widest text-foreground sm:text-2xl">
                {detail.name}
              </h2>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {detail.ticker}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {hasData
                ? `${detail.hitRate.toFixed(0)}% Trefferquote über ${detail.total} Prognose${detail.total === 1 ? '' : 'n'} · ${trades.length} echte Trade${trades.length === 1 ? '' : 's'}.`
                : `Noch keine Prognosen · ${trades.length} echte Trade${trades.length === 1 ? '' : 's'}.`}
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

        {/* Echte Trades zu diesem Instrument */}
        <div className="mt-6 glass-card p-4">
          <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Echte Trades zu diesem Instrument
          </p>
          {trades.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              Noch keine Trades — nur Prognosen.{' '}
              <Link href="/trades/new" className="text-primary hover:underline">
                Trade planen
              </Link>
            </p>
          ) : (
            <div className="divide-y divide-border">
              {trades.map((t) => (
                <Link
                  key={t.id}
                  href={`/trades/${t.id}`}
                  className="flex items-center justify-between gap-3 py-2 font-mono text-xs hover:text-primary"
                >
                  <span className="flex items-center gap-2">
                    {t.direction === 'long' ? (
                      <ArrowUpRight className="size-3.5 text-positive" />
                    ) : (
                      <ArrowDownRight className="size-3.5 text-destructive" />
                    )}
                    <span className="font-bold text-foreground">{t.ticker}</span>
                    <span className="text-muted-foreground">@ {t.entryPrice}</span>
                  </span>
                  <span className="uppercase tracking-widest text-muted-foreground">
                    {t.status.replace('_', ' ')}
                    {t.result ? ` · ${t.result}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
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
