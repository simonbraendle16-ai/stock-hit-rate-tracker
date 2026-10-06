import { PendingTradeReviews } from '@/components/pending-trade-reviews'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { listEventsForTrades, listTargetsForTrades, listTrades } from '@/app/actions/trades'
import { listAlerts } from '@/app/actions/alerts'
import { triggeredTargetPricesByTrade } from '@/lib/alerts'
import { getSettings } from '@/app/actions/settings'
import { getScopeContext } from '@/app/actions/portfolios'
import { CockpitHeader } from '@/components/cockpit-header'
import { PaperBadge } from '@/components/paper-badge'
import { TradeCard } from '@/components/trade-card'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/db'
import { brokerOrder, portfolio } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { Plus } from 'lucide-react'

export default async function TradesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [trades, settings, kontext, brokerOrders] = await Promise.all([
    listTrades(),
    getSettings(),
    getScopeContext(),
    db.select({ order: brokerOrder }).from(brokerOrder)
      .innerJoin(portfolio, eq(brokerOrder.portfolioId, portfolio.id))
      .where(and(eq(brokerOrder.userId, session.user.id),
        eq(portfolio.userId, session.user.id), eq(portfolio.kind, 'demo')))
      .orderBy(desc(brokerOrder.id)).limit(100),
  ])

  // Teilziele (Etappe 13) und Ereignisse für die ganze Liste in je EINER Abfrage.
  //
  // Die Stufen werden bewusst UNGEKÜRZT weitergereicht: Seit die Live-Leiste die
  // erreichte Stufe ausführen kann, braucht sie deren `id`. Die Ereignisse
  // fehlten hier ganz — ohne sie rechnete die Leiste nach einem Teilverkauf mit
  // der vollen statt der Restposition.
  const ids = trades.map((t) => t.id)
  const [stufen, ereignisse, alerts] = await Promise.all([
    listTargetsForTrades(ids),
    listEventsForTrades(ids),
    listAlerts(),
  ])
  const stufenJeTrade = new Map<number, typeof stufen>()
  for (const s of stufen) {
    const bisher = stufenJeTrade.get(s.tradeId)
    if (bisher) bisher.push(s)
    else stufenJeTrade.set(s.tradeId, [s])
  }
  const ereignisseJeTrade = new Map<number, typeof ereignisse>()
  for (const e of ereignisse) {
    const bisher = ereignisseJeTrade.get(e.tradeId)
    if (bisher) bisher.push(e)
    else ereignisseJeTrade.set(e.tradeId, [e])
  }
  const beruehrt = triggeredTargetPricesByTrade(alerts)

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <PendingTradeReviews userId={session.user.id} />
        <div className="mb-7 flex items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">Trades</p>
              <span className="eyebrow text-muted-foreground">
                · {kontext.active ? kontext.active.name : 'Alle Echtgeld-Depots'}
              </span>
              {kontext.isPaper && <PaperBadge size="compact" />}
            </div>
            <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Plane, führe aus, schließe ab.
            </h2>
            {/* Die Zahl gilt für die aktive Auswahl, nicht für das ganze Konto —
                sonst würde sie mehr versprechen, als die Liste unten zeigt. */}
            <p className="note mt-1.5">
              {trades.length} Trade{trades.length === 1 ? '' : 's'}{' '}
              {kontext.active ? `in „${kontext.active.name}"` : 'in deinen Echtgeld-Depots'}
            </p>
          </div>
          <Link href="/trades/new">
            <Button className="btn-teal-glow font-mono text-xs">
              <Plus className="size-4" /> Neuer Trade
            </Button>
          </Link>
        </div>

        {brokerOrders.length > 0 && (
          <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="AvaTrade-Demo-Brokerbelege">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="eyebrow">Demo · AvaTrade</p>
                <h3 className="mt-1 font-heading text-lg font-semibold">Importierte Brokeraufträge und Positionen</h3>
              </div>
              <Link href="/broker-orders" className="text-sm underline">Alle Brokerbelege ansehen</Link>
            </div>
            <p className="note mt-2 text-xs">Brokerbelege sind erst nach bestätigtem Planbezug geplante App-Trades.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {brokerOrders.map(({ order }) => (
                <div key={order.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <strong>{order.ticker} · {order.direction === 'long' ? 'Kauf' : 'Verkauf'}</strong>
                    <span className="text-xs text-muted-foreground">
                      {order.state === 'accepted' ? 'Angenommen' : order.state === 'filled' ? 'Ausgeführt' : 'Storniert'}
                    </span>
                  </div>
                  <p className="note mt-1 text-xs">Order-ID {order.brokerOrderId} · Menge {order.quantity ?? 'offen'}</p>
                  <p className="note text-xs">Zuletzt gesehen: {order.observedAt.toLocaleString('de-DE')}</p>
                  {order.linkedTradeId && (
                    <Link href={`/trades/${order.linkedTradeId}`} className="mt-2 inline-block text-xs underline">
                      Verknüpften Trade öffnen
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {trades.length === 0 ? (
          <div className="panel sheen rise-in p-10 text-center">
            <p className="text-sm text-foreground">
              Noch keine Trades. Plane deinen ersten — mit klarem Plan, bevor du ihn eingehst.
            </p>
            <Link href="/trades/new" className="mt-4 inline-block">
              <Button className="btn-teal-glow font-mono text-xs">
                <Plus className="size-4" /> Trade planen
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trades.map((t, i) => (
              /* Gestaffelter Aufbau wie im Cockpit: Die Verzögerung muss auf dem
                 Element sitzen, das die Animation trägt — deshalb bekommt die
                 Karte sie als Prop, nicht der Wrapper. */
              <TradeCard
                key={t.id}
                t={t}
                currency={t.accountCurrency ?? kontext.currency}
                targets={stufenJeTrade.get(t.id)}
                events={ereignisseJeTrade.get(t.id)}
                triggeredTargetPrices={beruehrt.get(t.id)}
                delayMs={Math.min(i, 8) * 45}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
