import type { SVGProps } from 'react'

type MarkProps = SVGProps<SVGSVGElement>

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/* A — Impuls: Elliott-Welle als aufsteigender Impuls mit Korrekturen. */
export function MarkImpulse(props: MarkProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 18.5 6.5 11.5 9.5 14.5 13 5.5 15.5 9 20.5 3.5" />
      <path d="M16.6 3.5h3.9v3.9" strokeWidth={1.6} />
    </svg>
  )
}

/* B — Treffer: reduzierte Zielscheibe mit Kurs-Tick im Zentrum. */
export function MarkTarget(props: MarkProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <path d="M12 3.4v2.1M12 18.5v2.1M3.4 12h2.1M18.5 12h2.1" strokeWidth={1.5} />
    </svg>
  )
}

/* C — Kerzen: drei Kerzen auf Basislinie, die letzte bricht nach oben aus. */
export function MarkCandles(props: MarkProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 5.5v13M12 3.5v17M18 6.5v11" strokeWidth={1.5} />
      <rect x="4.1" y="9" width="3.8" height="6" rx="1" />
      <rect x="10.1" y="7" width="3.8" height="9" rx="1" fill="currentColor" />
      <rect x="16.1" y="10.5" width="3.8" height="4.5" rx="1" />
    </svg>
  )
}

/* D — Monogramm: T über C, serifenbetont wie ein Bankenzeichen. */
export function MarkMonogram(props: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M19.8 15.4a6.1 6.1 0 1 1 0-6.9"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4.4 5.4h10.2M9.5 5.4V18.6"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </svg>
  )
}

/* E — Cockpit: Instrumenten-Skala mit Nadel im Zielbereich. */
export function MarkGauge(props: MarkProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.6 17.2a9.4 9.4 0 1 1 16.8 0" />
      <path d="M12 17.2 16.6 9.8" />
      <circle cx="12" cy="17.2" r="1.5" fill="currentColor" stroke="none" />
      <path d="M5.6 8.4 6.8 9.6M12 4.2v1.7M18.4 8.4 17.2 9.6" strokeWidth={1.5} />
    </svg>
  )
}

/* F — Fadenkreuz + Welle: Präzisionsraster über dem Impuls. */
export function MarkCrosshairWave(props: MarkProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.8" strokeWidth={1.6} />
      <path d="M6.4 14.6 9.4 10.4 11.8 12.6 17.4 6.9" />
      <path d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2" strokeWidth={1.5} />
    </svg>
  )
}

export const logoDrafts = [
  {
    id: 'impulse',
    name: 'A · Impuls',
    note: 'Elliott-Impuls mit Ausbruchspfeil. Klar, dynamisch, chart-nah.',
    Mark: MarkImpulse,
  },
  {
    id: 'target',
    name: 'B · Treffer',
    note: 'Zielscheibe mit Zentrumstreffer. Direkte Metapher für Trefferquote.',
    Mark: MarkTarget,
  },
  {
    id: 'candles',
    name: 'C · Kerzen',
    note: 'Drei Kerzen, die mittlere massiv. Sehr gut lesbar bei 16 px.',
    Mark: MarkCandles,
  },
  {
    id: 'monogram',
    name: 'D · Monogramm TC',
    note: 'T und C ineinander. Institutionell, ruhig, wenig Illustration.',
    Mark: MarkMonogram,
  },
  {
    id: 'gauge',
    name: 'E · Cockpit',
    note: 'Instrumenten-Skala mit Nadel. Greift den Cockpit-Namen auf.',
    Mark: MarkGauge,
  },
  {
    id: 'crosshair',
    name: 'F · Fadenkreuz',
    note: 'Welle im Präzisionsraster. Disziplin plus Setup-Genauigkeit.',
    Mark: MarkCrosshairWave,
  },
] as const
