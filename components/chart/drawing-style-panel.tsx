'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Trash2, X } from 'lucide-react'
import type { Drawing, DrawingStyle } from '@/app/actions/drawings'
import {
  addLevel,
  DEFAULT_FIB,
  DEFAULT_FIBEXT,
  normalizeFibStil,
  removeLevel,
  toggleLevel,
  type FibBeschriftung,
  type FibStil,
} from '@/lib/fib-levels'
import {
  normalizeDrawingStyle,
  ZEICHEN_FARBEN,
  ZEICHEN_STAERKEN,
} from '@/lib/drawing-style'
import { CHART_COLORS } from './colors'
import {
  flaechenForm,
  istLinienTyp,
  linienForm,
  type EndCap,
  type Extend,
} from '@/lib/line-form'

const TYP_NAMEN: Record<string, string> = {
  hline: 'Horizontale Linie',
  vline: 'Vertikale Linie',
  trendline: 'Trendlinie',
  ray: 'Strahl',
  arrow: 'Pfeil',
  channel: 'Paralleler Kanal',
  rect: 'Rechteck',
  ellipse: 'Ellipse',
  brush: 'Freihand',
  fib: 'Fib-Retracement',
  fibext: 'Fib-Extension',
  ew_impulse: 'Elliott-Impuls',
  ew_correction: 'Elliott-Korrektur',
  longpos: 'Long-Position',
  shortpos: 'Short-Position',
  text: 'Notiz',
  pricerange: 'Preis-Range',
  daterange: 'Zeit-Range',
}

const EXTEND_LABELS: { id: Extend; label: string; hinweis: string }[] = [
  { id: 'none', label: 'aus', hinweis: 'Strecke — endet an beiden Punkten' },
  { id: 'left', label: '←', hinweis: 'Nach links verlängern' },
  { id: 'right', label: '→', hinweis: 'Nach rechts verlängern (Strahl)' },
  { id: 'both', label: '↔', hinweis: 'Beidseitig — die Gerade' },
]

const END_LABELS: { id: EndCap; label: string }[] = [
  { id: 'none', label: '—' },
  { id: 'arrow', label: '▸' },
  { id: 'dot', label: '•' },
]

const BESCHRIFTUNGEN: { id: FibBeschriftung; label: string }[] = [
  { id: 'beides', label: 'Beides' },
  { id: 'preis', label: 'Kurs' },
  { id: 'prozent', label: '%' },
  { id: 'aus', label: 'Aus' },
]

/** Ein kleiner Umschalter — überall gleich, damit das Panel ruhig bleibt. */
function Schalter({
  an,
  onClick,
  children,
}: {
  an: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[10px] transition-colors ${
        an
          ? 'bg-accent/20 text-foreground'
          : 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'
      }`}
    >
      <span
        className={`flex size-3 shrink-0 items-center justify-center rounded-sm border ${
          an ? 'border-accent bg-accent/40' : 'border-muted-foreground/40'
        }`}
      >
        {an && <Check className="size-2.5" />}
      </span>
      {children}
    </button>
  )
}

/**
 * Eigenschaften der ausgewählten Zeichnung.
 *
 * Vorher ließ sich eine gezogene Linie nur noch verschieben oder löschen —
 * keine Farbe, keine Stärke, und beim Fibonacci weder Levels noch Beschriftung.
 * Genau das war gemeint mit „man kann daran nichts ändern".
 *
 * Das Panel hängt am `<body>`, NICHT im Chart-Baum: Die Chart-Karte trägt
 * `.rise-in`, deren `transform` auch nach der Animation stehen bleibt und damit
 * zum Bezugsrahmen für `position: fixed` wird. Und `position` MUSS inline
 * stehen, weil `body > * { position: relative }` in `globals.css` außerhalb der
 * Tailwind-Layer liegt und die Utility `.fixed` schlägt. Beides zusammen hat
 * schon einmal Menüs 1200 px zu tief landen lassen — siehe `chart-toolbar.tsx`.
 */
export function DrawingStylePanel({
  drawing,
  top,
  left,
  onChange,
  onDelete,
  onClose,
  onSaveDefault,
}: {
  drawing: Drawing
  top: number
  left: number
  onChange: (style: DrawingStyle) => void
  onDelete: () => void
  onClose: () => void
  /** Diese Fib-Einstellung als eigenen Standard für neue Zeichnungen sichern. */
  onSaveDefault?: (typ: 'fib' | 'fibext', stil: FibStil) => void
}) {
  const [neuesLevel, setNeuesLevel] = useState('')
  const [gesichert, setGesichert] = useState(false)

  const istFib = drawing.type === 'fib' || drawing.type === 'fibext'
  const istLinie = istLinienTyp(drawing.type)
  const form = linienForm(drawing.type, drawing.style)
  // Nur das Rechteck: Preis- und Zeit-Range leben von ihrer Füllung, dort wäre
  // „Füllung aus" eine leere Behauptung.
  const istFlaeche = drawing.type === 'rect'
  const flaeche = flaechenForm(drawing.type, drawing.style)
  const stil = normalizeDrawingStyle(
    drawing.style,
    istFib ? CHART_COLORS.warning : CHART_COLORS.accent,
  )
  const fib = istFib
    ? normalizeFibStil(
        drawing.style?.fib,
        drawing.type === 'fibext' ? DEFAULT_FIBEXT : DEFAULT_FIB,
      )
    : null

  const setzen = (teil: Partial<DrawingStyle>) => {
    setGesichert(false)
    onChange({ ...(drawing.style ?? {}), ...teil })
  }
  const setzeFib = (next: FibStil) => {
    setGesichert(false)
    // Farbe und Stärke der Zeichnung bleiben die führenden Werte — sonst
    // stünde dasselbe an zwei Stellen und liefe auseinander.
    onChange({ ...(drawing.style ?? {}), fib: { ...next, farbe: stil.color, staerke: stil.width } })
  }

  const levelHinzufuegen = () => {
    if (!fib) return
    // Deutsche Eingabe erlauben: 0,618 ist hier die normale Schreibweise.
    const wert = Number(neuesLevel.replace(',', '.').trim())
    if (!Number.isFinite(wert)) return
    setzeFib(addLevel(fib, wert))
    setNeuesLevel('')
  }

  return createPortal(
    <div
      className="panel-raised z-50 flex w-[248px] flex-col gap-2 overflow-y-auto p-2.5"
      style={{
        position: 'fixed',
        top,
        left,
        maxHeight: `calc(100vh - ${top + 16}px)`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{TYP_NAMEN[drawing.type] ?? 'Zeichnung'}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Schließen"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Farbe */}
      <div>
        <p className="note mb-1">Farbe</p>
        <div className="flex flex-wrap gap-1">
          {ZEICHEN_FARBEN.map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.label}
              aria-label={f.label}
              onClick={() => setzen({ color: f.wert })}
              className={`size-5 rounded-full border-2 transition-transform hover:scale-110 ${
                stil.color.toLowerCase() === f.wert.toLowerCase()
                  ? 'border-foreground'
                  : 'border-transparent'
              }`}
              style={{ background: f.wert }}
            />
          ))}
        </div>
      </div>

      {/* Stärke + Strichart */}
      <div className="flex items-end gap-3">
        <div>
          <p className="note mb-1">Stärke</p>
          <div className="flex gap-1">
            {ZEICHEN_STAERKEN.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setzen({ width: w })}
                aria-label={`Stärke ${w}`}
                className={`flex h-6 w-6 items-center justify-center rounded ${
                  stil.width === w ? 'bg-accent/25' : 'hover:bg-accent/10'
                }`}
              >
                <span
                  className="w-4 rounded-full"
                  style={{ height: Math.max(1, w), background: stil.color }}
                />
              </button>
            ))}
          </div>
        </div>
        <Schalter an={stil.dashed} onClick={() => setzen({ dashed: !stil.dashed })}>
          gestrichelt
        </Schalter>
      </div>

      {/* Linien-Form — nachgebaut nach TradingViews Style-Reiter.
          Das ist der Kern der Etappe „Tiefe statt Breite": Ob eine Linie
          verlängert wird, eine Spitze trägt oder Kennzahlen zeigt, war bei uns
          bis hierher der TYP der Zeichnung. Wer eine Strecke gezogen hatte und
          sie danach als Strahl wollte, musste löschen und neu ziehen. */}
      {istLinie && (
        <div className="space-y-2 border-t border-border/40 pt-2">
          <div>
            <p className="note mb-1">Verlängern</p>
            <div className="flex gap-1">
              {EXTEND_LABELS.map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  variant={form.extend === e.id ? 'secondary' : 'ghost'}
                  className="h-6 flex-1 px-1 font-mono text-[10px]"
                  title={e.hinweis}
                  onClick={() => setzen({ extend: e.id })}
                >
                  {e.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <p className="note mb-1">Anfang</p>
              <div className="flex gap-1">
                {END_LABELS.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={form.leftEnd === c.id ? 'secondary' : 'ghost'}
                    className="h-6 flex-1 px-1 font-mono text-[10px]"
                    onClick={() => setzen({ leftEnd: c.id })}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="note mb-1">Ende</p>
              <div className="flex gap-1">
                {END_LABELS.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={form.rightEnd === c.id ? 'secondary' : 'ghost'}
                    className="h-6 flex-1 px-1 font-mono text-[10px]"
                    onClick={() => setzen({ rightEnd: c.id })}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <Schalter an={form.stats} onClick={() => setzen({ stats: !form.stats })}>
              Kurs, % und Balken
            </Schalter>
            <Schalter
              an={form.priceLabels}
              onClick={() => setzen({ priceLabels: !form.priceLabels })}
            >
              Kurs-Etiketten
            </Schalter>
            <Schalter
              an={form.middlePoint}
              onClick={() => setzen({ middlePoint: !form.middlePoint })}
            >
              Mittelpunkt
            </Schalter>
          </div>
        </div>
      )}

      {/* Fläche — nachgebaut nach TradingViews Rechteck-Dialog. */}
      {istFlaeche && (
        <div className="space-y-2 border-t border-border/40 pt-2">
          <div>
            <p className="note mb-1">Verlängern</p>
            <div className="flex gap-1">
              {EXTEND_LABELS.map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  variant={flaeche.extend === e.id ? 'secondary' : 'ghost'}
                  className="h-6 flex-1 px-1 font-mono text-[10px]"
                  title={e.hinweis}
                  onClick={() => setzen({ extend: e.id })}
                >
                  {e.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Schalter an={flaeche.border} onClick={() => setzen({ border: !flaeche.border })}>
              Rahmen
            </Schalter>
            <Schalter
              an={flaeche.background}
              onClick={() => setzen({ background: !flaeche.background })}
            >
              Füllung
            </Schalter>
            <Schalter
              an={flaeche.middleLine}
              onClick={() => setzen({ middleLine: !flaeche.middleLine })}
            >
              Mittellinie
            </Schalter>
          </div>
        </div>
      )}

      {fib && (
        <>
          <div className="border-t border-border/40 pt-2">
            <p className="note mb-1">Beschriftung</p>
            <div className="flex gap-1">
              {BESCHRIFTUNGEN.map((b) => (
                <Button
                  key={b.id}
                  size="sm"
                  variant={fib.beschriftung === b.id ? 'secondary' : 'ghost'}
                  className="h-6 flex-1 px-1 font-mono text-[10px]"
                  onClick={() => setzeFib({ ...fib, beschriftung: b.id })}
                >
                  {b.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <Schalter
              an={fib.verlaengern}
              onClick={() => setzeFib({ ...fib, verlaengern: !fib.verlaengern })}
            >
              nach rechts verlängern
            </Schalter>
            <Schalter an={fib.flaeche} onClick={() => setzeFib({ ...fib, flaeche: !fib.flaeche })}>
              Flächen einfärben
            </Schalter>
          </div>

          <div>
            <p className="note mb-1">Levels</p>
            <div className="flex flex-wrap gap-1">
              {fib.levels.map((l) => (
                <span key={l.wert} className="group relative">
                  <button
                    type="button"
                    onClick={() => setzeFib(toggleLevel(fib, l.wert))}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      l.an
                        ? 'bg-accent/25 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/10'
                    }`}
                  >
                    {String(l.wert).replace('.', ',')}
                  </button>
                  <button
                    type="button"
                    aria-label={`Level ${l.wert} entfernen`}
                    onClick={() => setzeFib(removeLevel(fib, l.wert))}
                    className="absolute -right-1 -top-1 hidden size-3 items-center justify-center rounded-full bg-destructive text-[8px] text-white group-hover:flex"
                  >
                    <X className="size-2" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1">
              <Input
                value={neuesLevel}
                onChange={(e) => setNeuesLevel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    levelHinzufuegen()
                  }
                }}
                placeholder="z. B. 1,272"
                className="h-6 flex-1 font-mono text-[10px]"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 font-mono text-[10px]"
                onClick={levelHinzufuegen}
              >
                +
              </Button>
            </div>
          </div>

          {onSaveDefault && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 justify-start px-1.5 font-mono text-[10px] text-muted-foreground"
              onClick={() => {
                onSaveDefault(drawing.type === 'fibext' ? 'fibext' : 'fib', {
                  ...fib,
                  farbe: stil.color,
                  staerke: stil.width,
                })
                setGesichert(true)
              }}
            >
              {gesichert ? '✓ als Standard gesichert' : 'Als meinen Standard sichern'}
            </Button>
          )}
        </>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="h-7 justify-start gap-1.5 border-t border-border/40 px-1.5 font-mono text-[10px] text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3" />
        Zeichnung löschen
      </Button>
    </div>,
    document.body,
  )
}
