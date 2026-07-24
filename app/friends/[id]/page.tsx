import Link from 'next/link'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getFriendJournal } from '@/app/actions/friends'
import type { FriendJournal, FriendTrade } from '@/lib/friends'
import { CockpitHeader } from '@/components/cockpit-header'
import { FriendStats, RuleViolationLine } from '@/components/friend-stats'
import { cn } from '@/lib/utils'
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Lock, ShieldAlert } from 'lucide-react'

export default async function FriendJournalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { id: friendId } = await params

  let journal: FriendJournal | null = null
  let denied = false
  try {
    journal = await getFriendJournal(friendId)
  } catch {
    // assertCanView wirft ohne angenommene Freundschaft → „sofort blind".
    denied = true
  }

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/friends"
          className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Zurück zu Freunde
        </Link>

        {denied || !journal ? (
          <div className="glass-card flex flex-col items-center gap-2 p-10 text-center">
            <Lock className="size-8 text-muted-foreground/50" />
            <p className="font-mono text-sm text-muted-foreground">
              Kein Zugriff auf dieses Journal.
            </p>
            <p className="max-w-md font-mono text-xs text-muted-foreground/70">
              Ihr seid nicht (mehr) befreundet. Ein Journal ist nur sichtbar, solange die
              Freundschaft besteht.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {journal.name}
              </h2>
              <div className="mt-1">
                <RuleViolationLine summary={journal.summary} />
              </div>
            </div>

            <FriendStats summary={journal.summary} />

            <TradeSection
              title="Abgeschlossen"
              hint="Ergebnis in R-Vielfachen — größenunabhängig, ohne Beträge."
              trades={journal.trades.filter((t) => t.status === 'abgeschlossen')}
              emptyLabel="Noch keine abgeschlossenen Trades."
            />

            <TradeSection
              title="Geplant"
              hint="Offene Absichten mit geplantem Chance-Risiko-Verhältnis."
              trades={journal.trades.filter((t) => t.status === 'geplant')}
              emptyLabel="Keine geplanten Trades."
            />
          </>
        )}
      </main>
    </div>
  )
}

function TradeSection({
  title,
  hint,
  trades,
  emptyLabel,
}: {
  title: string
  hint: string
  trades: FriendTrade[]
  emptyLabel: string
}) {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {title}
          {trades.length > 0 && ` (${trades.length})`}
        </h3>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{hint}</p>
      </div>
      {trades.length === 0 ? (
        <p className="glass-card p-4 font-mono text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {trades.map((t) => (
            <li key={t.id}>
              <TradeRow trade={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TradeRow({ trade: t }: { trade: FriendTrade }) {
  const isLong = t.direction === 'long'
  const Dir = isLong ? ArrowUpRight : ArrowDownRight
  const when = t.status === 'abgeschlossen' ? t.closedAt : t.createdAt

  return (
    <div className="glass-card flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            isLong ? 'bg-positive/10 text-positive' : 'bg-destructive/10 text-destructive',
          )}
        >
          <Dir className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-bold text-foreground">
            {t.ticker}
            <span className="ml-2 font-normal text-muted-foreground">
              {isLong ? 'Long' : 'Short'}
            </span>
            {!t.followedPlan && t.status === 'abgeschlossen' && (
              <span className="ml-2 inline-flex items-center gap-1 font-normal text-warning">
                <ShieldAlert className="size-3" /> abgewichen
              </span>
            )}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {when
              ? new Date(when).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: 'short',
                  year: '2-digit',
                })
              : '—'}
            {t.plannedRR != null && ` · geplantes CRV ${t.plannedRR.toFixed(1)}`}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        {t.status === 'abgeschlossen' && t.r != null ? (
          <>
            <p
              className={cn(
                'font-heading text-lg font-bold',
                t.r >= 0 ? 'text-positive' : 'text-destructive',
              )}
            >
              {t.r >= 0 ? '+' : ''}
              {t.r.toFixed(2)}R
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {t.result}
            </p>
          </>
        ) : (
          <p className="rounded-md bg-primary/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-primary">
            geplant
          </p>
        )}
      </div>
    </div>
  )
}
