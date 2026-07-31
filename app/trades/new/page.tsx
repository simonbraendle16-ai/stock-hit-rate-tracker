import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CockpitHeader } from '@/components/cockpit-header'
import { TradeForm } from '@/components/trade-form'
import { getSettings } from '@/app/actions/settings'
import { getScopeContext } from '@/app/actions/portfolios'
import { toPortfolioOptions } from '@/lib/portfolio-scope'

export default async function NewTradePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [settings, kontext] = await Promise.all([getSettings(), getScopeContext()])

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Trade planen
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Lege den Plan fest, bevor du ihn eingehst. Danach wird nur noch ausgeführt.
          </p>
        </div>
        {/* Startkapital und Gebühren stehen am Depot (Etappe 12) und wechseln
            deshalb mit der Auswahl im Formular — sie kommen nicht mehr aus den
            kontoweiten Einstellungen. Vorbelegt ist das aktive Depot; ist in der
            Kopfzeile das Aggregat gewählt, muss man sich entscheiden. */}
        <TradeForm
          maxRiskPct={settings.maxRiskPct}
          currency={settings.currency}
          portfolios={toPortfolioOptions(kontext.portfolios)}
          defaultPortfolioId={kontext.active?.id ?? null}
        />
      </main>
    </div>
  )
}
