import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSettings } from '@/app/actions/settings'
import { listCashflows } from '@/app/actions/cashflows'
import { CockpitHeader } from '@/components/cockpit-header'
import { SettingsForm } from '@/components/settings-form'
import { CashflowList } from '@/components/cashflow-list'

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [settings, cashflows] = await Promise.all([getSettings(), listCashflows()])

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Einstellungen
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Konto & Risiko — die Basis für alle echten Geld-Kennzahlen.
          </p>
        </div>
        <SettingsForm initial={settings} />
        <div className="mt-5">
          <CashflowList items={cashflows} currency={settings.currency} />
        </div>
      </main>
    </div>
  )
}
