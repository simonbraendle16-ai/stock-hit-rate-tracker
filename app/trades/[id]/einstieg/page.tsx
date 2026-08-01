import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { getTrade, listTradeTargets } from '@/app/actions/trades'
import { getSettings } from '@/app/actions/settings'
import { CockpitHeader } from '@/components/cockpit-header'
import { EntryMoment } from '@/components/entry-moment'

/**
 * Der Einstiegs-Moment (Etappe 14).
 *
 * Ziel dieser Seite: Zwischen der Benachrichtigung auf dem Handy und der
 * Entscheidung soll nichts liegen als der eigene Plan. Deshalb ist sie das
 * Sprungziel jeder Einstiegs-Meldung — und deshalb ist sie so karg.
 *
 * Ein Trade, der nicht mehr geplant ist, hat diesen Moment hinter sich: Wer eine
 * halbe Stunde später auf den Link in der Mail tippt, landet auf der vollen
 * Trade-Ansicht statt auf einer Seite, die eine längst getroffene Entscheidung
 * noch einmal anbietet.
 */
export default async function EntryMomentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { id } = await params
  const t = await getTrade(Number(id))
  if (!t) notFound()
  if (t.status !== 'geplant') redirect(`/trades/${t.id}`)

  const [targets, settings] = await Promise.all([listTradeTargets(t.id), getSettings()])

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <EntryMoment trade={t} targets={targets} currency={settings.currency} />
      </main>
    </div>
  )
}
