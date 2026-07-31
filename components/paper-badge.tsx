import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Das Abzeichen PAPIERGELD (Etappe 12).
 *
 * Warum es überhaupt gebraucht wird: Ein Demo-Depot zeigt jetzt volle
 * Geldkennzahlen — Bilanz, Equity-Kurve, Drawdown, Risiko-Guard — gerechnet gegen
 * sein Papier-Startkapital. Genau das war der Wunsch: Nur so sieht man, ob die
 * Übung trägt, und nur so sind Prozentzahlen mit dem Ernstfall vergleichbar.
 *
 * Damit entsteht aber eine neue Gefahr, die es vorher nicht gab: Auf einem
 * Bildschirm voller Beträge ist Übungsgeld von echtem Geld nicht zu
 * unterscheiden. Ein Papier-Gewinn, der aussieht wie ein echter, ist dieselbe
 * Selbsttäuschung wie eine Papier-Quote in der echten Bilanz — nur eine Ebene
 * höher. Deshalb trägt JEDE Fläche, die im Demo-Depot einen Geldbetrag zeigt,
 * dieses Abzeichen.
 *
 * Bewusst zurückhaltend gestaltet (gedämpftes Gold, kein Glow, keine Bewegung):
 * Es soll unübersehbar sein, ohne die Zahlen zu überstrahlen — Geldbeträge tragen
 * in dieser App nie Leuchten, weil das Ergebnis vor Prozess rücken würde.
 */
export function PaperBadge({
  className,
  size = 'default',
}: {
  className?: string
  /** `compact` für enge Stellen wie Tabellenzeilen und Kartenköpfe. */
  size?: 'default' | 'compact'
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium tracking-wide uppercase',
        // Gold steht in dieser App unter `--warning` (#e0b455 im Dark-Theme) —
        // kein neuer Farbwert, sondern der vorhandene Token.
        'border-[color-mix(in_oklab,var(--warning)_40%,transparent)]',
        'bg-[color-mix(in_oklab,var(--warning)_12%,transparent)]',
        'text-[var(--warning)]',
        size === 'compact' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
        className,
      )}
      title="Übungsgeld. Diese Beträge rechnen gegen das Papier-Startkapital dieses Depots und zählen in keine Echtgeld-Kennzahl."
    >
      <FlaskConical className={size === 'compact' ? 'size-3' : 'size-3.5'} aria-hidden />
      Papiergeld
    </span>
  )
}

/**
 * Der erklärende Satz zum Abzeichen — für Seitenköpfe, wo Platz für einen Satz
 * ist. Steht hier neben dem Abzeichen, damit beide Texte nie auseinanderlaufen.
 */
export function PaperNotice({ className }: { className?: string }) {
  return (
    <p className={cn('note', className)}>
      Übungsgeld. Alle Beträge rechnen gegen das Papier-Startkapital dieses Depots und
      zählen in keine Echtgeld-Kennzahl — auch nicht in das, was Freunde sehen.
    </p>
  )
}
