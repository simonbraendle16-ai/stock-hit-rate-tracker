import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSettings } from '@/app/actions/settings'
import { listCashflows } from '@/app/actions/cashflows'
import { CockpitHeader } from '@/components/cockpit-header'
import { SettingsForm } from '@/components/settings-form'
import { CashflowList } from '@/components/cashflow-list'
import { PortfolioManager } from '@/components/portfolio-manager'
import { getPortfolioUsage, getScopeContext } from '@/app/actions/portfolios'

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [settings, cashflows, kontext, usage] = await Promise.all([
    getSettings(),
    listCashflows(),
    getScopeContext(),
    getPortfolioUsage(),
  ])

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Einstellungen
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Depots, Währung und Risiko — die Basis für alle Geld-Kennzahlen.
          </p>
        </div>
        <SettingsForm initial={settings} />
        {/* Startkapital und Gebühren stehen seit Etappe 12 hier, am Depot —
            nicht mehr kontoweit oben. */}
        <div className="mt-5">
          <PortfolioManager
            portfolios={kontext.portfolios}
            usage={usage}
            currency={settings.currency}
          />
        </div>
        <div className="mt-5">
          <CashflowList
            items={cashflows}
            currency={settings.currency}
            portfolios={kontext.portfolios}
            activePortfolioId={kontext.active?.id ?? null}
          />
        </div>
      </main>
    </div>
  )
}
