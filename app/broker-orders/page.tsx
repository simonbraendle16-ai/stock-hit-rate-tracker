import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { brokerOrder, portfolio } from '@/lib/db/schema'
import { CockpitHeader } from '@/components/cockpit-header'
import { and, desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

const stateLabel: Record<string, string> = {
  accepted: 'Beim Broker angenommen',
  filled: 'Ausgeführt',
  cancelled: 'Storniert',
}

export default async function BrokerOrdersPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const rows = await db.select({ order: brokerOrder, depotName: portfolio.name })
    .from(brokerOrder).innerJoin(portfolio, eq(brokerOrder.portfolioId, portfolio.id))
    .where(and(eq(brokerOrder.userId, session.user.id),
      eq(portfolio.userId, session.user.id), eq(portfolio.kind, 'demo')))
    .orderBy(desc(brokerOrder.id)).limit(100)

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-7">
          <p className="eyebrow">Demo · AvaTrade</p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Brokeraufträge</h1>
          <p className="note mt-2">Angenommene Orders und Ausführungen aus dem Broker. Fehlende Planangaben bleiben offen.</p>
          <Link className="mt-3 inline-block text-sm underline" href="/trades">Zurück zu Trades</Link>
        </div>
        {rows.length === 0 ? (
          <div className="panel p-8 text-sm">Noch keine Demo-Brokeraufträge importiert.</div>
        ) : (
          <div className="grid gap-3">
            {rows.map(({ order, depotName }) => (
              <article key={order.id} className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-heading text-lg font-semibold">{order.ticker} · {order.direction === 'long' ? 'Kauf' : 'Verkauf'}</h2>
                  <span className="text-xs">{stateLabel[order.state] ?? order.state}</span>
                </div>
                <p className="note mt-1 text-xs">{depotName} · Order-ID {order.brokerOrderId}</p>
                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Limit</dt><dd>{order.limitPrice ?? 'Nicht belegt'}</dd></div>
                  <div><dt className="text-muted-foreground">Stop</dt><dd>{order.stopLoss ?? 'Fehlt'}</dd></div>
                  <div><dt className="text-muted-foreground">Ziel</dt><dd>{order.takeProfit ?? 'Fehlt'}</dd></div>
                  <div><dt className="text-muted-foreground">Menge</dt><dd>{order.quantity ?? 'Nicht belegt'}</dd></div>
                  <div><dt className="text-muted-foreground">Ausführungskurs</dt><dd>{order.executionPrice ?? 'Noch nicht ausgeführt'}</dd></div>
                  <div><dt className="text-muted-foreground">Zuletzt gesehen</dt><dd>{order.observedAt.toLocaleString('de-DE')}</dd></div>
                </dl>
                {order.linkedTradeId ? (
                  <Link className="mt-4 inline-block text-sm underline" href={`/trades/${order.linkedTradeId}`}>
                    Verknüpften Plan #{order.linkedTradeId} öffnen
                  </Link>
                ) : <p className="note mt-4 text-xs">Noch keinem eindeutigen App-Plan zugeordnet.</p>}
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
