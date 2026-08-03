'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Clapperboard,
  LayoutDashboard,
  ListChecks,
  LineChart,
  List,
  Target,
  Users,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/', label: 'Cockpit', icon: LayoutDashboard },
  { href: '/watchlist', label: 'Watchlist', icon: List },
  { href: '/trainer', label: 'Trainer', icon: Clapperboard },
  { href: '/trades', label: 'Trades', icon: ListChecks },
  { href: '/analysis', label: 'Analyse', icon: Target },
  { href: '/tracking', label: 'Auswertung', icon: LineChart },
  { href: '/friends', label: 'Freunde', icon: Users },
  { href: '/settings', label: 'Einstellungen', icon: Settings },
]

export function CockpitNav() {
  const pathname = usePathname()
  return (
    // `justify-between` auf dem Handy: Die sieben Ziele verteilen sich über die
    // volle Zeilenbreite, statt links zu kleben. `shrink-0` an den Einträgen,
    // damit kein Ziel zusammengequetscht wird — lieber scrollt die Leiste.
    <nav className="flex items-center justify-between gap-1 sm:justify-start">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            data-active={active}
            className={cn(
              'nav-item flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-xs tracking-wide transition-colors sm:px-3',
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
