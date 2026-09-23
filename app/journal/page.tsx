import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CockpitHeader } from '@/components/cockpit-header'
import { JournalWorkspace } from '@/components/journal-workspace'
import { listInsights, listJournalEntries, listOwnTradesForJournal } from '@/app/actions/journal'

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ tradeId?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const params = await searchParams
  const tradeId = params.tradeId && /^[1-9]\d*$/.test(params.tradeId) ? Number(params.tradeId) : undefined
  const [entries, insights, trades] = await Promise.all([
    listJournalEntries(),
    listInsights(),
    listOwnTradesForJournal(),
  ])

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-7">
          <p className="eyebrow">Reflexion</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Was ist passiert? Was lerne ich daraus?
          </h2>
          <p className="note mt-2 max-w-2xl">
            Halte Situationen fest und prüfe Erkenntnisse anhand ihrer Belege. Eine Hypothese ändert keine Handelsregel.
          </p>
        </div>
        <JournalWorkspace
          initialTradeId={tradeId ?? null}
          trades={trades.map((t) => ({ id: t.id, ticker: t.ticker, status: t.status }))}
          entries={entries.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString(), createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() }))}
          insights={insights.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() }))}
        />
      </main>
    </div>
  )
}
