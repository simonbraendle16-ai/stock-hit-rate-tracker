import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getStocksWithStats } from '@/app/actions/stocks'
import { CockpitHeader } from '@/components/cockpit-header'
import { AddStockDialog } from '@/components/add-stock-dialog'
import { WatchlistGrid } from '@/components/watchlist/watchlist-grid'

export default async function WatchlistPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const stocks = await getStocksWithStats()

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Watchlist</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Alle Instrumente auf einen Blick
            </h2>
            <p className="note mt-1.5">Kurs, Verlauf, Trefferquote.</p>
          </div>
          <AddStockDialog />
        </div>

        <WatchlistGrid stocks={stocks} />
      </main>
    </div>
  )
}
