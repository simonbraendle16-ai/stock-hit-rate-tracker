import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getDisciplineStats, getUnifiedHitRateTimeline, listTrades } from '@/app/actions/trades'
import { getSettings } from '@/app/actions/settings'
import { getScopeContext } from '@/app/actions/portfolios'
import { PaperBadge, PaperNotice } from '@/components/paper-badge'
import { listAlerts } from '@/app/actions/alerts'
import { CockpitHeader } from '@/components/cockpit-header'
import {
  DisciplineBar,
  CockpitStats,
  FiveBeliefs,
} from '@/components/discipline-overview'
import { DouglasQuote } from '@/components/douglas-quote'
import { SectionLabel } from '@/components/section-label'
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

  const [stats, timeline, trades, settings, alerts, kontext] = await Promise.all([
    getDisciplineStats(),
    getUnifiedHitRateTimeline(),
    listTrades(),
    getSettings(),
    listAlerts(),
    // Welches Depot ist im Blick? Entscheidet, ob das Cockpit Papiergeld zeigt.
    getScopeContext(),
  ])
  const recent = trades.slice(0, 6)
  const openPositions = trades.filter((t) => t.status === 'aktiv')

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-7 flex items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">Cockpit</p>
              <span className="eyebrow text-muted-foreground">
                ·{' '}
                {kontext.active
                  ? kontext.active.name
                  : 'Alle Echtgeld-Depots'}
              </span>
              {/* Ohne dieses Abzeichen sähe eine Papier-Bilanz genauso aus wie
                  eine echte — die Verwechslung, die diese Etappe abschafft. */}
              {kontext.isPaper && <PaperBadge size="compact" />}
            </div>
            <h2 className="mt-1.5 font-heading text-xl font-semibold tracking-tight text-foreground">
              Handle deinen Plan, nicht deine Emotion.
            </h2>
            {kontext.isPaper && <PaperNotice className="mt-1 max-w-xl" />}
          </div>
          <Link href="/trades/new">
            <Button className="btn-teal-glow font-mono text-xs">
              <Plus className="size-4" /> Neuer Trade
            </Button>
          </Link>
        </div>

        <SectionLabel>Stand</SectionLabel>
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
        <SectionLabel className="mt-10">Im Markt</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {openPositions.length > 0 ? (
              <div className="panel sheen rise-in p-4 sm:p-5">
                <p className="eyebrow mb-3.5">
                  Offene Positionen · {openPositions.length}
                </p>
                <div className="space-y-3">
                  {openPositions.map((t) => (
                    <div key={t.id} className="panel-sunken p-3">
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
              <div className="panel sheen rise-in flex h-full flex-col justify-center p-6 text-center">
                <p className="note">
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

        <SectionLabel className="mt-10">Prozess</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <HitRateTimeline data={timeline} />
            <RiskCalculator currency={settings.currency} />
          </div>
          <div className="lg:col-span-1">
            <FiveBeliefs />
          </div>
        </div>

        {/* Letzte Trades */}
        <div className="panel sheen rise-in mt-4 p-4 sm:p-5">
          <div className="mb-3.5 flex items-center justify-between">
            <p className="eyebrow">Letzte Trades</p>
            <Link href="/trades" className="font-mono text-[11px] text-primary hover:underline">
              Alle ansehen
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="note">Noch keine Trades — plane deinen ersten.</p>
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
