'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ListChecks, LineChart, List, Target, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/', label: 'Cockpit', icon: LayoutDashboard },
  { href: '/watchlist', label: 'Watchlist', icon: List },
  { href: '/trades', label: 'Trades', icon: ListChecks },
  { href: '/analysis', label: 'Analyse', icon: Target },
  { href: '/tracking', label: 'Auswertung', icon: LineChart },
  { href: '/settings', label: 'Einstellungen', icon: Settings },
]

export function CockpitNav() {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs tracking-wide transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
