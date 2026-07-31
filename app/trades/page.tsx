import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { listTargetsForTrades, listTrades } from '@/app/actions/trades'
import { getSettings } from '@/app/actions/settings'
import { getScopeContext } from '@/app/actions/portfolios'
import { CockpitHeader } from '@/components/cockpit-header'
import { PaperBadge } from '@/components/paper-badge'
import { TradeCard } from '@/components/trade-card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default async function TradesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [trades, settings, kontext] = await Promise.all([
    listTrades(),
    getSettings(),
    getScopeContext(),
  ])

  // Teilziele (Etappe 13) für die ganze Liste in EINER Abfrage — auf der Karte
  // steht nur der Fortschritt, ausgeführt wird auf der Detailseite.
  const stufen = await listTargetsForTrades(trades.map((t) => t.id))
  const stufenJeTrade = new Map<number, { price: number; sharePct: number; executed: boolean }[]>()
  for (const s of stufen) {
    const eintrag = { price: s.price, sharePct: s.sharePct, executed: s.executedAt != null }
    const bisher = stufenJeTrade.get(s.tradeId)
    if (bisher) bisher.push(eintrag)
    else stufenJeTrade.set(s.tradeId, [eintrag])
  }

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
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
                currency={settings.currency}
                targets={stufenJeTrade.get(t.id)}
                delayMs={Math.min(i, 8) * 45}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
