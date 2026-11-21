import { CockpitHeader } from '@/components/cockpit-header'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Daily Sheet' }

export default async function DailySheetPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  return (
    <div className="flex h-svh flex-col">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      <main id="cockpit-content" tabIndex={-1} className="min-h-0 flex-1">
        <iframe title="Daily Sheet" src="/daily-sheet-playbook/index.html" className="block size-full border-0" />
      </main>
    </div>
  )
}
