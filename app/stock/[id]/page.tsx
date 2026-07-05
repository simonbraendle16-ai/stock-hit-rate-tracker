import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getStockDetail } from '@/app/actions/stocks'
import { getInstrumentTrades } from '@/app/actions/trades'
import { getDrawings } from '@/app/actions/drawings'
import { CockpitHeader } from '@/components/cockpit-header'
import { DistributionChart } from '@/components/distribution-chart'
import { HitRateTimeline } from '@/components/hitrate-timeline'
import { AssessmentList } from '@/components/assessment-list'
import { ChartLinkControl } from '@/components/chart-link-control'
import { PriceChart, type ChartMarker, type PlanLine } from '@/components/chart/price-chart'
import { PlanBar } from '@/components/chart/plan-bar'
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

  const [detail, trades, drawings] = await Promise.all([
    getStockDetail(stockId),
    getInstrumentTrades(stockId),
    getDrawings(stockId),
  ])
  if (!detail) notFound()

  const hasData = detail.total > 0

  // Plan-Overlay: Linien aus offenen Trades (geplant/aktiv), richtungsabhängig beschriftet.
  const openTrades = trades.filter((t) => t.status === 'geplant' || t.status === 'aktiv')
  const planLines: PlanLine[] = openTrades.flatMap((t) => {
    const dir = t.direction === 'long' ? 'Long' : 'Short'
    const lines: PlanLine[] = [
      { price: t.entryPrice, color: '#45a8ec', title: `Entry ${dir}` },
      { price: t.stopLoss, color: '#D8505F', title: `Stop ${dir}` },
    ]
    if (t.takeProfit != null) {
      lines.push({ price: t.takeProfit, color: '#4FBE8C', title: `Target ${dir}` })
    }
    if (t.elliottInvalidation != null) {
      lines.push({
        price: t.elliottInvalidation,
        color: '#D4AC4E',
        title: 'Elliott-Invalidation',
        dashed: true,
      })
    }
    return lines
  })

  // Assessment-Marker auf der Zeitachse (richtig/falsch/nicht angelaufen).
  const chartMarkers: ChartMarker[] = detail.assessments.map((a) => ({
    time: Math.floor(Date.parse(a.assessmentDate) / 1000),
    kind: a.zoneNotReached ? 'neutral' : a.isCorrect ? 'richtig' : 'falsch',
    text: '',
  }))

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
              <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {detail.name}
              </h2>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {detail.ticker}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {hasData
                ? `${detail.hitRate.toFixed(0)}% Trefferquote über ${detail.total} Prognose${detail.total === 1 ? '' : 'n'}${detail.notReached > 0 ? ` · ${detail.notReached} nicht angelaufen` : ''} · ${trades.length} echte Trade${trades.length === 1 ? '' : 's'}.`
                : `Noch keine Prognosen${detail.notReached > 0 ? ` · ${detail.notReached} nicht angelaufen` : ''} · ${trades.length} echte Trade${trades.length === 1 ? '' : 's'}.`}
            </p>
          </div>

          <ChartLinkControl
            stockId={detail.id}
            stockName={detail.name}
            chartUrl={detail.chartUrl}
          />
        </div>

        <div className="mb-6">
          <PriceChart
            symbol={detail.ticker}
            market={detail.market}
            planLines={planLines}
            markers={chartMarkers}
            stockId={detail.id}
            initialDrawings={drawings}
          />
          <PlanBar
            trades={openTrades.map((t) => ({
              id: t.id,
              direction: t.direction === 'short' ? ('short' as const) : ('long' as const),
              status: t.status,
              entryPrice: t.entryPrice,
              stopLoss: t.stopLoss,
              takeProfit: t.takeProfit,
              elliottInvalidation: t.elliottInvalidation,
              riskRewardRatio: t.riskRewardRatio,
            }))}
          />
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
