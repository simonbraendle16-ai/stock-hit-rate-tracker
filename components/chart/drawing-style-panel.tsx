'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Trash2, X } from 'lucide-react'
import type { Drawing, DrawingPoint, DrawingStyle } from '@/app/actions/drawings'
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
  strichMuster,
  strichSetzen,
  STRICHARTEN,
  ZEICHEN_FARBEN,
  ZEICHEN_STAERKEN,
  type Strichart,
} from '@/lib/drawing-style'
import {
  balkenIndex,
  formatKurs,
  parseBalken,
  parseKurs,
  zeitAusBalken,
} from '@/lib/drawing-coords'
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

const STRICH_NAMEN: Record<Strichart, string> = {
  solid: 'durchgezogen',
  dashed: 'gestrichelt',
  dotted: 'gepunktet',
}

/**
 * Die Punkte einer Zeichnung als Zahlen — TradingViews Reiter „Coordinates".
 *
 * **Warum das mehr ist als Bequemlichkeit.** Diese App misst Plan-Treue. Ein
 * Stop, der 0,3 % neben der Marke liegt, weil die Hand am Zeiger gezittert hat,
 * macht aus einem plan-konformen Trade rechnerisch einen anderen. Wer den Kurs
 * kennt, muss ihn hinschreiben können.
 *
 * **Die Balkenzahl ist relativ zur letzten Kerze** (0 = letzte, negativ =
 * davor, positiv = Projektion) — genau wie in TradingView nachgesehen, und aus
 * demselben Grund: Ein absoluter Index verschöbe sich, sobald der
 * Kerzenspeicher Historie nachlädt. Umgerechnet wird in `lib/drawing-coords.ts`.
 *
 * Die Felder tragen ihren eigenen Text, solange man tippt, und geben ihn erst
 * bei Enter oder beim Verlassen weiter. Bei jedem Tastendruck zu übernehmen
 * hieße: Wer „63.5" getippt hat, sieht die Zeichnung schon nach oben springen,
 * bevor „33,80" fertig ist.
 */
function Koordinaten({
  points,
  times,
  step,
  onChange,
}: {
  points: DrawingPoint[]
  times: number[]
  step: number
  onChange: (points: DrawingPoint[]) => void
}) {
  const [entwurf, setEntwurf] = useState<Record<string, string>>({})

  // Wird die Zeichnung im Chart gezogen, sind die getippten Werte überholt.
  useEffect(() => setEntwurf({}), [points])

  const uebernehmen = (i: number, feld: 'preis' | 'balken', text: string) => {
    const next = [...points]
    if (feld === 'preis') {
      const v = parseKurs(text)
      if (v == null) {
        setEntwurf((e) => ({ ...e, [`${i}p`]: '' }))
        return
      }
      next[i] = { ...next[i], price: v }
    } else {
      const b = parseBalken(text)
      if (b == null) {
        setEntwurf((e) => ({ ...e, [`${i}b`]: '' }))
        return
      }
      next[i] = { ...next[i], time: zeitAusBalken(times, step, b) }
    }
    setEntwurf({})
    onChange(next)
  }

  const feld = (i: number, feld: 'preis' | 'balken', wert: string) => {
    const key = `${i}${feld === 'preis' ? 'p' : 'b'}`
    return (
      <Input
        value={entwurf[key] ?? wert}
        onChange={(e) => setEntwurf((s) => ({ ...s, [key]: e.target.value }))}
        onBlur={(e) => uebernehmen(i, feld, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            uebernehmen(i, feld, (e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') setEntwurf((s) => ({ ...s, [key]: '' }))
          // Sonst schluckt die Zeichenebene die Taste und löscht die Auswahl.
          e.stopPropagation()
        }}
        aria-label={`Punkt ${i + 1} ${feld === 'preis' ? 'Kurs' : 'Balken'}`}
        className="h-6 min-w-0 flex-1 px-1.5 text-right font-mono text-[10px]"
      />
    )
  }

  return (
    <div className="space-y-1 border-t border-border/40 pt-2">
      <p className="note mb-1">Koordinaten</p>
      <div className="flex gap-1 pr-1 font-mono text-[9px] text-muted-foreground">
        <span className="w-5" />
        <span className="flex-1 text-right">Kurs</span>
        <span className="flex-1 text-right">Balken</span>
      </div>
      {points.map((p, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
            #{i + 1}
          </span>
          {feld(i, 'preis', formatKurs(p.price))}
          {feld(i, 'balken', String(balkenIndex(times, step, p.time)))}
        </div>
      ))}
      <p className="note text-[9px] leading-tight">
        Balken zählt ab der letzten Kerze: 0 ist sie selbst, −10 zehn davor, +10 zehn
        voraus.
      </p>
    </div>
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
  times,
  step,
  onPointsChange,
}: {
  drawing: Drawing
  top: number
  left: number
  onChange: (style: DrawingStyle) => void
  onDelete: () => void
  onClose: () => void
  /** Diese Fib-Einstellung als eigenen Standard für neue Zeichnungen sichern. */
  onSaveDefault?: (typ: 'fib' | 'fibext', stil: FibStil) => void
  /** Zeitraster der Kerzen — für die Balkenzahl im Koordinaten-Abschnitt. */
  times?: number[]
  step?: number
  /** Punkte numerisch setzen. Fehlt sie, bleibt der Abschnitt weg. */
  onPointsChange?: (points: DrawingPoint[]) => void
}) {
  const [neuesLevel, setNeuesLevel] = useState('')
  const [gesichert, setGesichert] = useState(false)

  const istFib = drawing.type === 'fib' || drawing.type === 'fibext'
  const istLinie = istLinienTyp(drawing.type)
  const form = linienForm(drawing.type, drawing.style)
  // Rechteck und Kanal: Preis- und Zeit-Range leben von ihrer Füllung, dort
  // wäre „Füllung aus" eine leere Behauptung. Der Kanal kam nach der
  // TradingView-Recherche dazu — sein Dialog „Parallel channel" führt genau
  // dieselben Regler (Extend · Background · Mittellinie).
  const istFlaeche = drawing.type === 'rect' || drawing.type === 'channel'
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
        {/* Drei Bilder statt eines Häkchens „gestrichelt" — so führt es
            TradingView im Knopf „Style", und im Chart trägt der Unterschied
            Bedeutung: gepunktet liest sich als Vermutung, durchgezogen als
            gesetzte Marke. */}
        <div className="min-w-0 flex-1">
          <p className="note mb-1">Strichart</p>
          <div className="flex gap-1">
            {STRICHARTEN.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setzen(strichSetzen(s))}
                aria-label={STRICH_NAMEN[s]}
                title={STRICH_NAMEN[s]}
                className={`flex h-6 flex-1 items-center rounded px-1.5 ${
                  stil.strich === s ? 'bg-accent/25' : 'hover:bg-accent/10'
                }`}
              >
                <svg viewBox="0 0 32 6" className="h-1.5 w-full" preserveAspectRatio="none">
                  <line
                    x1={0}
                    y1={3}
                    x2={32}
                    y2={3}
                    stroke={stil.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray={strichMuster(s, 2)}
                  />
                </svg>
              </button>
            ))}
          </div>
        </div>
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
            {/* TradingViews `Reverse`. Ohne das entscheidet die Ziehrichtung
                darüber, wo 0 liegt — und die lässt sich nachträglich nur durch
                Löschen und Neuziehen ändern. */}
            <Schalter
              an={fib.umkehren}
              onClick={() => setzeFib({ ...fib, umkehren: !fib.umkehren })}
            >
              Skala umdrehen (0 ans andere Ende)
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

      {/* Koordinaten — TradingViews Reiter „Coordinates". Freihand hat bis zu
          480 Punkte; die einzeln aufzulisten wäre kein Werkzeug, sondern eine
          Tabelle. */}
      {onPointsChange && times && times.length > 0 && step && drawing.points.length <= 6 && (
        <Koordinaten
          points={drawing.points}
          times={times}
          step={step}
          onChange={onPointsChange}
        />
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
