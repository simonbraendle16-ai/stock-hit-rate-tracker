import Link from 'next/link'
import { Activity, BarChart3, Repeat } from 'lucide-react'

// Etappe 14, Abschnitt 5: Gliederung der Auswertungsseite.
//
// WARUM
// Über die Etappen 5–13 ist `/tracking` zu einer Säule aus einem Dutzend Panels
// gewachsen — Equity, Bot-Zwilling, MAE/MFE, Monte-Carlo, Setups, Zeit, Zustand,
// Depots, Instrumente. Jedes einzelne ist begründet, zusammen beantworten sie
// aber die Frage „wo schaue ich jetzt hin?" nicht mehr. Man scrollt, statt zu
// lesen.
//
// Die Gliederung ist rein visuell: **keine Kennzahl wird angefasst**, nichts
// verschwindet, nichts wird zusammengefasst. Es kommen nur drei Überschriften
// und drei Sprungmarken dazu.
//
// Die drei Fragen dahinter, in dieser Reihenfolge:
//   Ergebnis — was ist herausgekommen?
//   Prozess  — wie bin ich damit umgegangen?     (der Douglas-Kern)
//   Muster   — was zeigt sich über viele Trades?
//
// Ergebnis steht zuerst, weil man es ohnehin zuerst sucht; direkt danach kommt
// der Prozess, der in dieser App die eigentliche Aussage trägt.

export const TRACKING_SECTIONS = [
  { id: 'ergebnis', label: 'Ergebnis', hint: 'Was ist herausgekommen?', icon: BarChart3 },
  { id: 'prozess', label: 'Prozess', hint: 'Wie bin ich damit umgegangen?', icon: Activity },
  { id: 'muster', label: 'Muster', hint: 'Was zeigt sich über viele Trades?', icon: Repeat },
] as const

/** Die Sprungleiste unter dem Seitenkopf. Reine Links — kein Client-Zustand. */
export function TrackingNav() {
  return (
    <nav className="mt-4 flex flex-wrap gap-2">
      {TRACKING_SECTIONS.map(({ id, label, hint, icon: Icon }) => (
        <Link
          key={id}
          href={`#${id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          title={hint}
        >
          <Icon className="size-3" />
          {label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Überschrift eines Abschnitts, zugleich Sprungziel.
 *
 * `scroll-mt-20`: Ohne Abstand landet die Überschrift beim Springen unter der
 * Kopfzeile und man sieht mitten im ersten Panel.
 */
export function TrackingSection({
  id,
  children,
}: {
  id: (typeof TRACKING_SECTIONS)[number]['id']
  children: React.ReactNode
}) {
  const section = TRACKING_SECTIONS.find((s) => s.id === id)!
  const Icon = section.icon
  return (
    <div id={id} className="mt-8 scroll-mt-20 border-t border-border/60 pt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight text-foreground">
          <Icon className="size-4 text-primary" />
          {section.label}
        </h3>
        <p className="font-mono text-[11px] text-muted-foreground">{section.hint}</p>
      </div>
      {children}
    </div>
  )
}
