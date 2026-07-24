import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getDisciplineStats, getUnifiedHitRateTimeline, listTrades } from '@/app/actions/trades'
import { getSettings } from '@/app/actions/settings'
import { listAlerts } from '@/app/actions/alerts'
import { CockpitHeader } from '@/components/cockpit-header'
import {
  DisciplineBar,
  CockpitStats,
  FiveBeliefs,
} from '@/components/discipline-overview'
import { DouglasQuote } from '@/components/douglas-quote'
import { RiskCalculator } from '@/components/risk-calculator'
import { HitRateTimeline } from '@/components/hitrate-timeline'
import { LivePosition } from '@/components/live-position'
import { AlertsPanel } from '@/components/alerts-panel'
import { AlertWatcher } from '@/components/alert-watcher'
import { Button } from '@/components/ui/button'
import { Plus, ArrowUpRight, ArrowDownRight } from 'lucide-react'

export default async function CockpitPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [stats, timeline, trades, settings, alerts] = await Promise.all([
    getDisciplineStats(),
    getUnifiedHitRateTimeline(),
    listTrades(),
    getSettings(),
    listAlerts(),
  ])
  const recent = trades.slice(0, 6)
  const openPositions = trades.filter((t) => t.status === 'aktiv')

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Cockpit
            </h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              Handle deinen Plan, nicht deine Emotion.
            </p>
          </div>
          <Link href="/trades/new">
            <Button className="btn-teal-glow font-mono text-xs">
              <Plus className="size-4" /> Neuer Trade
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DisciplineBar stats={stats} />
          </div>
          <div className="lg:col-span-1">
            <DouglasQuote />
          </div>
        </div>

        <div className="mt-4">
          <CockpitStats stats={stats} />
        </div>

        {/* Offene Positionen mit Live-Stand + Kurs-Alerts (Etappe 3). Der
            AlertWatcher rendert nichts, prüft aber im Hintergrund. */}
        <AlertWatcher />
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {openPositions.length > 0 ? (
              <div className="glass-card p-4">
                <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Offene Positionen · {openPositions.length}
                </p>
                <div className="space-y-3">
                  {openPositions.map((t) => (
                    <div key={t.id} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/trades/${t.id}`}
                          className="flex items-center gap-2 font-mono text-sm hover:text-primary"
                        >
                          {t.direction === 'long' ? (
                            <ArrowUpRight className="size-4 text-positive" />
                          ) : (
                            <ArrowDownRight className="size-4 text-destructive" />
                          )}
                          <span className="font-bold text-foreground">{t.ticker}</span>
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {t.direction} · {t.market}
                          </span>
                        </Link>
                      </div>
                      <LivePosition t={t} currency={settings.currency} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="glass-card flex h-full flex-col justify-center p-6 text-center">
                <p className="font-mono text-xs text-muted-foreground">
                  Keine offenen Positionen. Aktivierte Trades erscheinen hier mit Live-Stand,
                  Abstand zu Stop und Ziel und unrealisiertem P&L.
                </p>
              </div>
            )}
          </div>
          <div className="lg:col-span-1">
            <AlertsPanel alerts={alerts} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <HitRateTimeline data={timeline} />
            <RiskCalculator currency={settings.currency} />
          </div>
          <div className="lg:col-span-1">
            <FiveBeliefs />
          </div>
        </div>

        {/* Letzte Trades */}
        <div className="mt-4 glass-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Letzte Trades
            </p>
            <Link href="/trades" className="font-mono text-[11px] text-primary hover:underline">
              Alle ansehen
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              Noch keine Trades — plane deinen ersten.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((t) => (
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
      </main>
    </div>
  )
}
