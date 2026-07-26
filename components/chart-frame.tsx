import type React from 'react'
import { cn } from '@/lib/utils'

type IconType = React.ComponentType<{ className?: string }>

/**
 * Einheitlicher Kopf über jedem Diagramm — vorher hatte jede Chart-Komponente
 * ihre eigene Variante aus Icon, Titel und Unterzeile.
 */
export function ChartHeader({
  icon: Icon,
  title,
  subtitle,
  right,
}: {
  icon: IconType
  title: string
  /** Erklärende Unterzeile. Entfällt, wo der Titel für sich steht (Formularkarten). */
  subtitle?: string
  /** Optionale Kennzahl rechts im Kopf — z. B. der aktuelle Stand der Kurve. */
  right?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>
          {subtitle && <p className="note mt-1">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

/**
 * Einheitlicher Leerzustand. Ein Diagramm ohne Daten ist kein Fehler, sondern
 * ein normaler Zustand am Anfang — der Text sagt deshalb, was zu tun ist.
 *
 * Die kleine Schleife darüber zeigt, was hier entstehen wird: ein Kurs, der in
 * eine Zielzone läuft. Bewusst dieselbe Bildsprache wie die Anmeldeseite und
 * die echten Charts, damit die leere Fläche nicht wie ein Defekt wirkt.
 */
export function ChartEmpty({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: IconType
  title: string
  hint: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center',
        className ?? 'h-[280px]',
      )}
    >
      <svg
        viewBox="0 0 160 64"
        className="h-14 w-40 text-primary"
        fill="none"
        aria-hidden="true"
      >
        {/* Grundlinie */}
        <line x1="6" y1="56" x2="154" y2="56" stroke="var(--border)" strokeWidth="1" />
        {/* Zielzone — dieselbe Optik wie im Chart-Cockpit */}
        <rect
          className="empty-zone"
          x="92"
          y="10"
          width="62"
          height="16"
          rx="2"
          fill="currentColor"
          fillOpacity="0.08"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        {/* Der Kurs läuft hinein */}
        <path
          className="empty-path"
          d="M6,50 L26,45 L44,47 L62,38 L80,34 L98,26 L116,22 L134,18 L152,19"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ '--dash': '190' } as React.CSSProperties}
        />
      </svg>
      <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
        {title}
      </p>
      <p className="note mt-1.5 max-w-xs">{hint}</p>
    </div>
  )
}
