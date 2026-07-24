import Link from 'next/link'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { listFriends } from '@/app/actions/friends'
import { CockpitHeader } from '@/components/cockpit-header'
import { InvitePanel } from '@/components/invite-panel'
import { FriendStats, RuleViolationLine } from '@/components/friend-stats'
import { Users, ChevronRight } from 'lucide-react'
import { FriendRemoveButton } from '@/components/friend-remove-button'

export default async function FriendsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const friends = await listFriends()

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Freunde
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
            Ein Journal, das niemand sieht, hält niemanden ehrlich. Hier sieht jemand deine
            Regelbrüche — und du seine. Abgeschlossene Trades erscheinen nur in R-Vielfachen, nie in
            Beträgen: vergleichbar, ohne die Kontogröße zu verraten. Kein Copy-Trading.
          </p>
        </div>

        <InvitePanel />

        <section className="mt-8">
          <h3 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Deine Freunde{friends.length > 0 && ` (${friends.length})`}
          </h3>

          {friends.length === 0 ? (
            <div className="glass-card flex flex-col items-center gap-2 p-10 text-center">
              <Users className="size-8 text-muted-foreground/50" />
              <p className="font-mono text-sm text-muted-foreground">
                Noch keine Freunde verbunden.
              </p>
              <p className="max-w-md font-mono text-xs text-muted-foreground/70">
                Erzeuge oben einen Einladungscode und gib ihn weiter — oder löse einen erhaltenen
                Code ein.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {friends.map((f) => (
                <div key={f.friendId} className="glass-card p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 font-heading text-sm font-bold text-primary">
                        {initials(f.name)}
                      </div>
                      <div>
                        <p className="font-heading text-base font-semibold text-foreground">
                          {f.name}
                        </p>
                        <RuleViolationLine summary={f.summary} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <FriendRemoveButton friendId={f.friendId} name={f.name} />
                      <Link
                        href={`/friends/${f.friendId}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/20"
                      >
                        Journal <ChevronRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                  <FriendStats summary={f.summary} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
