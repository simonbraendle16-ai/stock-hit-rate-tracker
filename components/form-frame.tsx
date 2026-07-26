import type React from 'react'
import { ChartHeader } from '@/components/chart-frame'
import { cn } from '@/lib/utils'

/**
 * Gemeinsame Bausteine für die Formulare — das Gegenstück zu `chart-frame.tsx`
 * auf den Analyse-Flächen (Design-Etappe E).
 *
 * Vorher trug jedes Formular seine eigene Variante aus Karte, Beschriftung,
 * Auswahlknopf und Ergebniskasten; dieselbe Sache stand mal in 9 px, mal in
 * 10 px, mal in 11 px. Hier stehen die vier Formen einmal:
 *
 * - `FormSection` — die Karte (Ebene 2) mit demselben Kopf wie jedes Diagramm
 * - `Field`       — Beschriftung (`.eyebrow`) über einem Eingabefeld
 * - `ChoiceButton`— die Segment-Wahl (Long/Short, Geld/Demo, Ja/Nein)
 * - `ResultBlock` — der getönte Kasten, der eine Rechnung zurückgibt
 *
 * Die Töne stehen als feste Klassen-Maps da: Tailwind braucht statische
 * Namen, Interpolation fällt beim Build heraus (dieselbe Regel wie in
 * `mood-check.tsx`).
 */

type IconType = React.ComponentType<{ className?: string }>

export type Tone = 'neutral' | 'primary' | 'positive' | 'destructive' | 'warning'

/** Beschriftungen: der Ton färbt nur den Text, nie die Fläche. */
const labelTone: Record<Tone, string> = {
  neutral: '',
  primary: 'text-primary/70',
  positive: 'text-positive/70',
  destructive: 'text-destructive/70',
  warning: 'text-warning/70',
}

/** Gewählter Zustand einer Segment-Wahl — Kante, leichte Fläche, Text. */
const choiceActive: Record<Tone, string> = {
  neutral: 'border-foreground/30 bg-foreground/10 text-foreground',
  primary: 'border-primary/40 bg-primary/15 text-primary',
  positive: 'border-positive/40 bg-positive/15 text-positive',
  destructive: 'border-destructive/40 bg-destructive/15 text-destructive',
  warning: 'border-warning/40 bg-warning/15 text-warning',
}

/** Ergebniskästen: vertiefte Ebene, vom Ton nur eingefärbt. */
const resultTone: Record<Tone, string> = {
  neutral: '',
  primary: 'border-primary/25 bg-primary/5',
  positive: 'border-positive/25 bg-positive/5',
  destructive: 'border-destructive/25 bg-destructive/5',
  warning: 'border-warning/25 bg-warning/5',
}

const resultHeadTone: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  positive: 'text-positive',
  destructive: 'text-destructive',
  warning: 'text-warning',
}

/**
 * Formularkarte. Sie liegt auf Ebene 2 (`.panel-raised`) — dieselbe Stufe wie
 * der Hero einer Seite, denn auf einer Formularseite ist das Formular das
 * Wichtigste. Der Kopf ist derselbe wie über jedem Diagramm.
 */
export function FormSection({
  icon,
  title,
  hint,
  right,
  delay,
  children,
  className,
}: {
  icon: IconType
  title: string
  /** Erklärung unter dem Titel — kurz, nüchtern, ohne Ausrufezeichen. */
  hint?: string
  right?: React.ReactNode
  /** Staffelung beim Aufbau: `rise-in-1` … `rise-in-4`. */
  delay?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('panel-raised rise-in p-5', delay, className)}>
      <ChartHeader icon={icon} title={title} subtitle={hint} right={right} />
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/**
 * Beschriftetes Eingabefeld. Standardmässig ein echtes `<label>`, das seinen
 * Inhalt umschliesst — damit ist die Beschriftung mit dem Feld verbunden, ohne
 * dass jedes Feld eine `id` braucht. Für Gruppen aus Knöpfen `as="div"`, weil
 * ein Knopf nicht in ein Label gehört.
 */
export function Field({
  label,
  icon: Icon,
  tone = 'neutral',
  hint,
  as = 'label',
  children,
  className,
}: {
  label: string
  icon?: IconType
  tone?: Tone
  hint?: string
  as?: 'label' | 'div'
  children: React.ReactNode
  className?: string
}) {
  const Tag = as
  return (
    <Tag className={cn('flex flex-col gap-2', className)}>
      <span className={cn('eyebrow flex items-center gap-1', labelTone[tone])}>
        {Icon && <Icon className="size-3" />}
        {label}
      </span>
      {children}
      {hint && <span className="note">{hint}</span>}
    </Tag>
  )
}

/**
 * Eine Wahl aus zwei oder drei Möglichkeiten. Der ungewählte Zustand bleibt
 * bewusst still (nur Kante) — gewählt wird über Farbe entschieden, nicht über
 * Leuchten.
 */
export function ChoiceButton({
  active,
  tone = 'primary',
  icon: Icon,
  onClick,
  disabled,
  children,
  className,
}: {
  active: boolean
  tone?: Tone
  icon?: IconType
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 rounded-lg border py-2.5 font-mono text-sm font-bold transition-colors disabled:opacity-50',
        active
          ? choiceActive[tone]
          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
        className,
      )}
    >
      {Icon && <Icon className="size-4" />}
      {children}
    </button>
  )
}

/**
 * Der Kasten, in dem eine Rechnung zurückkommt (Take-Profit, Stop-Loss,
 * Hebelwirkung). Vertiefte Ebene statt aufgesetzter Fläche — das Ergebnis
 * liegt im Formular, es liegt nicht darüber.
 */
export function ResultBlock({
  tone = 'neutral',
  icon: Icon,
  title,
  children,
  className,
}: {
  tone?: Tone
  icon?: IconType
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('panel-sunken p-3', resultTone[tone], className)}>
      {title && (
        <div className={cn('eyebrow mb-2 flex items-center gap-1.5', resultHeadTone[tone])}>
          {Icon && <Icon className="size-3.5" />}
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * Eine Zeile in einem `ResultBlock`: Beschriftung oben, Zahl darunter.
 * Zahlen laufen immer tabellarisch, damit Spalten untereinander stehen.
 */
export function ResultRow({
  label,
  value,
  tone = 'neutral',
  strong,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'destructive'
  strong?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          'tabular text-xs',
          strong ? 'font-bold' : 'font-medium',
          tone === 'positive' && 'text-positive',
          tone === 'destructive' && 'text-destructive',
          tone === 'neutral' && 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Hinweiszeile mit Kante — für Kennzahlen, die das Formular selbst ausrechnet
 * und die den Trade bewerten (CRV, Konto-Risiko). Kein Kasten, keine
 * Überschrift: eine Zeile, die mitläuft.
 */
export function InlineNotice({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: Tone
  icon?: IconType
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 font-mono text-sm',
        resultTone[tone],
        resultHeadTone[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </p>
  )
}
