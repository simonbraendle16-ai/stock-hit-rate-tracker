import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { listTrades } from '@/app/actions/trades'
import { getSettings } from '@/app/actions/settings'
import { CockpitHeader } from '@/components/cockpit-header'
import { TradeCard } from '@/components/trade-card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default async function TradesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [trades, settings] = await Promise.all([listTrades(), getSettings()])

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Trades
            </h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {trades.length} Trade{trades.length === 1 ? '' : 's'} · plane, führe aus, schließe ab.
            </p>
          </div>
          <Link href="/trades/new">
            <Button className="btn-teal-glow font-mono text-xs">
              <Plus className="size-4" /> Neuer Trade
            </Button>
          </Link>
        </div>

        {trades.length === 0 ? (
          <div className="glass-card p-10 text-center">
            <p className="font-mono text-sm text-muted-foreground">
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
            {trades.map((t) => (
              <TradeCard key={t.id} t={t} currency={settings.currency} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
