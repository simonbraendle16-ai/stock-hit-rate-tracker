import Link from 'next/link'
import { Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import { CockpitNav } from '@/components/cockpit-nav'

/** Shared presentation; account controls come from the authenticated header. */
export function CockpitFrame({ account, moneyIssue }: { account: ReactNode; moneyIssue?: string | null }) {
  return (
    <header className="cockpit-header">
      <a className="cockpit-skip" href="#cockpit-content">Zum Inhalt</a>
      <div className="cockpit-top">
        <Link href="/" className="cockpit-brand">
          <span className="cockpit-logo"><Activity aria-hidden="true" /></span>
          <span>Trading Cockpit</span>
        </Link>
        <div className="cockpit-account">{account}</div>
      </div>
      <aside className="cockpit-sidebar">
        <p className="cockpit-nav-label">Arbeitsbereiche</p>
        <CockpitNav />
      </aside>
      {moneyIssue && <p role="status" className="cockpit-money-issue">{moneyIssue}</p>}
    </header>
  )
}
