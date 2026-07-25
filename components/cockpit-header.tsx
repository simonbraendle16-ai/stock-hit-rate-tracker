import Link from 'next/link'
import { Activity } from 'lucide-react'
import { CockpitNav } from '@/components/cockpit-nav'
import { SignOutButton } from '@/components/sign-out-button'

export function CockpitHeader({ userLabel }: { userLabel?: string | null }) {
  return (
    // Deckendes Panel statt `backdrop-blur`: Weichzeichnen ist ein Glas-Signal,
    // das der Designbrief („kein Glas, kein Glow") ausschließt.
    <header className="sticky top-0 z-10 border-b border-border bg-sidebar">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="size-5" />
          </div>
          <div className="hidden sm:block">
            <h1 className="font-heading text-base font-semibold leading-tight tracking-tight text-foreground">
              Trading Cockpit
            </h1>
            <p className="eyebrow mt-0.5">Disziplin · Elliott · Trefferquote</p>
          </div>
        </Link>
        <CockpitNav />
        <div className="flex items-center gap-2">
          {userLabel && (
            <span className="hidden font-mono text-xs text-muted-foreground md:inline">
              {userLabel}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}
