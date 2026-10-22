'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Clapperboard,
  LayoutDashboard,
  ListChecks,
  BookOpenText,
  LineChart,
  List,
  Target,
  Users,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TRAINER_ENABLED } from '@/lib/trainer-availability'

const items = [
  { href: '/', label: 'Cockpit', icon: LayoutDashboard },
  { href: '/watchlist', label: 'Watchlist', icon: List },
  { href: '/trainer', label: 'Trainer', icon: Clapperboard },
  { href: '/trades', label: 'Trades', icon: ListChecks },
  { href: '/journal', label: 'Journal', icon: BookOpenText },
  { href: '/analysis', label: 'Analyse', icon: Target },
  { href: '/tracking', label: 'Auswertung', icon: LineChart },
  { href: '/friends', label: 'Freunde', icon: Users },
  { href: '/settings', label: 'Einstellungen', icon: Settings },
]

export function CockpitNav() {
  const pathname = usePathname()
  return (
    <nav className="cockpit-nav" aria-label="Hauptnavigation">
      {items.filter(item => TRAINER_ENABLED || item.href !== '/trainer').map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            data-active={active}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'nav-item cockpit-nav-item',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
