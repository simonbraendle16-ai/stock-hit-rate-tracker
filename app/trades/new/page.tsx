import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { CockpitHeader } from '@/components/cockpit-header'
import { TradeForm } from '@/components/trade-form'

export default async function NewTradePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  return (
    <div className="min-h-svh bg-background">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="font-heading text-xl font-bold tracking-widest text-foreground sm:text-2xl">
            TRADE PLANEN
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Lege den Plan fest, bevor du ihn eingehst. Danach wird nur noch ausgeführt.
          </p>
        </div>
        <TradeForm />
      </main>
    </div>
  )
}
