import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getTrade, listTradeEvents, listTradeTargets } from '@/app/actions/trades'
import { getTradeExcursion } from '@/app/actions/excursion'
import { getStockChartUrl } from '@/app/actions/stocks'
import { getSettings } from '@/app/actions/settings'
import { CockpitHeader } from '@/components/cockpit-header'
import { TradeCard } from '@/components/trade-card'
import { TradeTimeline } from '@/components/trade-timeline'
import { TradeReplay } from '@/components/trade-replay'
import { SetupTagsCard } from '@/components/setup-tags-card'
import { ExcursionCard } from '@/components/excursion-card'
import { TradePortfolioCard } from '@/components/trade-portfolio-card'
import { TradeTargetsCard } from '@/components/trade-targets-card'
import { getScopeContext } from '@/app/actions/portfolios'
import { ArrowLeft, LineChart, Lock } from 'lucide-react'

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { id } = await params
  const t = await getTrade(Number(id))
  if (!t) notFound()

  const [chartUrl, settings, events, targets, excursion, kontext] = await Promise.all([
    t.stockId != null ? getStockChartUrl(t.stockId) : Promise.resolve(null),
    getSettings(),
    listTradeEvents(t.id),
    // Teilziele (Etappe 13) — leer bei jedem Trade ohne Staffelplan.
    listTradeTargets(t.id),
    // Holt Kerzen — bricht nie ab: eine Lücke wird als Lücke ausgewiesen
    // (Etappe 7c). Bei nicht entschiedenen Trades gibt es nichts zu messen.
    getTradeExcursion(t.id).catch(() => null),
    // Für die Depot-Karte. `getTrade` filtert bewusst NICHT auf die aktive
    // Auswahl — ein Trade muss sich öffnen lassen, auch wenn gerade ein anderes
    // Depot im Blick ist. Sonst käme man an einen falsch einsortierten Trade
    // nicht heran, um ihn umzubuchen.
    getScopeContext(),
  ])
  const locked = t.status === 'aktiv' || t.status === 'abgeschlossen'
  const violations: string[] = t.ruleViolations ? JSON.parse(t.ruleViolations) : []

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/trades"
          className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Zurück
        </Link>

        <div className="grid grid-cols-1 gap-4">
          <TradeCard t={t} currency={settings.currency} events={events} />

          {/* Wo liegt dieser Trade — und wie kommt er woandershin? */}
          <TradePortfolioCard
            tradeId={t.id}
            ticker={t.ticker}
            portfolioId={t.portfolioId}
            portfolios={kontext.portfolios}
          />

          {/* Der Staffelplan und seine Ausführung — direkt unter der Karte, weil
              die nächste Stufe die nächste Handlung ist. */}
          <TradeTargetsCard trade={t} targets={targets} events={events} />

          <TradeReplay t={t} />

          <TradeTimeline trade={t} events={events} />

          {/* Gegenlauf/Mitlauf (Etappe 7c) — nur bei entschiedenen Trades. */}
          {excursion && <ExcursionCard entry={excursion} />}

          {chartUrl && (
            <a
              href={chartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="panel sheen flex items-center gap-2 p-3 font-mono text-[11px] text-primary hover:underline"
            >
              <LineChart className="size-4" /> Chart dieses Instruments öffnen
            </a>
          )}

          {locked && (
            <div className="panel sheen flex items-center gap-2 p-3">
              <Lock className="size-4 text-primary" />
              <p className="font-mono text-[11px] text-muted-foreground">
                Plan-Lock aktiv: Einstieg, Stop und Invalidation sind festgeschrieben. Der Stop
                wird nicht verschoben (Douglas).
              </p>
            </div>
          )}

          {violations.length > 0 && (
            <div className="panel sheen border-destructive/30 p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-destructive">
                Regelbrüche
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                {violations.map((v) => (
                  <li key={v}>
                    ✗{' '}
                    {v === 'stop_moved'
                      ? 'Stop-Loss verschoben'
                      : v === 'invalidation_ignored'
                        ? 'Invalidation geändert'
                        : v === 'revenge'
                          ? 'Revenge-Trade (kurz nach Verlust eröffnet)'
                          : v}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Setup (Etappe 7b): die auswertbare Schublade — auch bei
              abgeschlossenen Trades noch nachtragbar, siehe SetupTagsCard. */}
          <SetupTagsCard trade={t} />

          {t.strategy && <Panel title="Begründung / Strategie">{t.strategy}</Panel>}
          {t.notes && <Panel title="Notizen">{t.notes}</Panel>}
          {/* Die Skala und die Tags stehen schon auf der Karte — hier steht der
              Freitext, für den dort kein Platz ist. */}
          {t.moodEntryNote && (
            <Panel title="Zustand beim Einstieg">{t.moodEntryNote}</Panel>
          )}
          {t.moodExitNote && <Panel title="Zustand beim Ausstieg">{t.moodExitNote}</Panel>}
          {t.elliottInvalidation != null && (
            <Panel title="Elliott-Invalidation">
              Analyse ungültig ab {t.elliottInvalidation}
            </Panel>
          )}
        </div>
      </main>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel sheen p-4">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-primary/70">
        {title}
      </p>
      <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-foreground">{children}</p>
    </div>
  )
}
