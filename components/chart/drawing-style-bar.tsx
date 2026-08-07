'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  GripVertical,
  Lock,
  MoreHorizontal,
  Settings2,
  Trash2,
  Unlock,
} from 'lucide-react'
import type { Drawing, DrawingStyle } from '@/app/actions/drawings'
import {
  normalizeDrawingStyle,
  strichMuster,
  strichSetzen,
  STRICHARTEN,
  ZEICHEN_FARBEN,
  ZEICHEN_STAERKEN,
  type Strichart,
} from '@/lib/drawing-style'
import { CHART_COLORS } from './colors'

/**
 * Die schwebende Stil-Leiste an einer ausgewählten Zeichnung.
 *
 * **Warum sie das Eck-Panel ablöst.** Das Eigenschaften-Panel lag fest an der
 * Preisachse und war 248 px breit — es verdeckte genau den Teil des Charts, in
 * dem die Zeichnung meistens liegt, und stand mit voller Höhe da, auch wenn man
 * nur die Farbe wechseln wollte. Die häufigen Handgriffe (Farbe, Stärke,
 * Strichart, weg damit) gehören an das Objekt, das sie betreffen; alles
 * Seltenere bleibt im Panel, das über den Zahnrad-Knopf aufgeht.
 *
 * **Was TradingView dort führt** (an einer Trendlinie in SBUX aus dem DOM
 * gelesen, Klasse `floating-toolbar-react-widgets`, 410 × 38 px, zehn Knöpfe in
 * dieser Reihenfolge):
 *
 *   Templates · Line tool colors · Line tool text colors · Line tool width ·
 *   Style · Settings · Add alert · Lock · Remove · More
 *
 * Das korrigiert zwei Annahmen, mit denen wir hier angetreten sind: Strichart
 * und Endpunkt-Marker sind **keine** eigenen Knöpfe (sie stecken in „Style"
 * bzw. im Einstellungs-Dialog), und eine „Sichtbarkeit je Zeitebene" gibt es in
 * der Leiste nicht.
 *
 * **Was wir bewusst nicht übernehmen:**
 * - *Templates* — das sind in TradingView benannte Stil-Vorlagen mit eigener
 *   Verwaltung. Wir haben mit `drawing-defaults` bereits einen Standard je
 *   Werkzeug; ein zweiter, konkurrierender Vorrat an Stilen wäre eine zweite
 *   Wahrheit darüber, wie eine neue Zeichnung aussieht. Der Knopf „…" bietet
 *   deshalb an, den aktuellen Stil als **diesen einen** Standard zu sichern.
 * - *Add alert* — ein Alert hängt in dieser App an einem Trade-Level
 *   (`price_alert`), nicht an einer freien Linie. Ein Alert ohne Plan dahinter
 *   ist genau die Beobachtungs-Sucht, gegen die die App gebaut ist.
 * - *Line tool text colors* — Text tragen bei uns nur `text` und `callout`, und
 *   die färben sich über dieselbe Farbe wie die Zeichnung.
 *
 * **Sie hängt am `<body>` und trägt `position` inline.** Beides ist in diesem
 * Projekt Pflicht für alles Schwebende über dem Chart und hat schon einmal Zeit
 * gekostet: `.rise-in` lässt am Panel ein `transform` stehen (damit wäre das
 * Panel der Bezugsrahmen statt des Fensters), und `body > * { position:
 * relative }` in `globals.css` liegt außerhalb der Tailwind-Layer und schlägt
 * die Utility `.fixed`. Siehe `chart-toolbar.tsx`.
 */

/** Abstand zwischen Leiste und Zeichnung. */
const LUFT = 10
/**
 * Womit gerechnet wird, bevor gemessen ist — verhindert einen Sprung im ersten
 * Bild. Beides wird danach am echten Element abgenommen: Geschätzte Maße waren
 * hier schon um 4 px daneben, und daraus wurde aus 10 px Luft über der
 * Zeichnung 6 px.
 */
const BREITE_SCHAETZUNG = 240
const HOEHE_SCHAETZUNG = 38

export interface AuswahlRahmen {
  left: number
  top: number
  right: number
  bottom: number
}

function klemmen(min: number, wert: number, max: number): number {
  return Math.max(min, Math.min(wert, max))
}

/**
 * Wo die Leiste sitzt: mittig über der Zeichnung, sonst darunter.
 *
 * Über der Zeichnung, weil man beim Zeichnen von oben nach unten liest und die
 * Leiste dort nichts verdeckt, was gerade entsteht. Reicht der Platz nach oben
 * nicht (Zeichnung am oberen Chartrand), klappt sie nach unten — sie darf nie
 * aus dem Bild laufen, sonst sieht es aus wie ein defektes Werkzeug.
 */
function lage(rahmen: AuswahlRahmen, breite: number, hoehe: number) {
  const mitte = (rahmen.left + rahmen.right) / 2
  const left = klemmen(8, mitte - breite / 2, window.innerWidth - breite - 8)
  const oben = rahmen.top - hoehe - LUFT
  const top =
    oben >= 8 ? oben : klemmen(8, rahmen.bottom + LUFT, window.innerHeight - hoehe - 8)
  return { top, left }
}

/** Ein Knopf der Leiste — überall gleich groß, damit die Reihe ruhig bleibt. */
function Knopf({
  titel,
  aktiv,
  onClick,
  children,
}: {
  titel: string
  aktiv?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={titel}
      aria-label={titel}
      onClick={onClick}
      className={`flex size-7 shrink-0 items-center justify-center rounded transition-colors ${
        aktiv ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

/** Das aufklappbare Feld unter einem Knopf. */
function Klappe({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel-raised absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 p-2">
      {children}
    </div>
  )
}

type OffeneKlappe = 'farbe' | 'staerke' | 'strich' | 'mehr' | null

export function DrawingStyleBar({
  drawing,
  rahmen,
  onChange,
  onOpenSettings,
  onDelete,
  onClone,
  locked,
  onLockedChange,
  onSaveDefault,
}: {
  drawing: Drawing
  /** Das Rechteck der Zeichnung im Fenster — daran hängt die Leiste. */
  rahmen: AuswahlRahmen
  onChange: (style: DrawingStyle) => void
  /** Den vollen Eigenschaften-Dialog öffnen (Zahnrad). */
  onOpenSettings: () => void
  onDelete: () => void
  onClone?: () => void
  locked: boolean
  onLockedChange: (v: boolean) => void
  /** Farbe und Stärke als Standard für neue Zeichnungen sichern. */
  onSaveDefault?: (color: string, width: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [{ breite, hoehe }, setMasse] = useState({
    breite: BREITE_SCHAETZUNG,
    hoehe: HOEHE_SCHAETZUNG,
  })
  const [offen, setOffen] = useState<OffeneKlappe>(null)
  const [gesichert, setGesichert] = useState(false)
  /**
   * Von Hand verschoben. Ab dann folgt die Leiste der Zeichnung NICHT mehr —
   * wer sie beiseite zieht, will sie dort haben, auch wenn er die Linie danach
   * verschiebt. TradingViews Leiste verhält sich genauso.
   */
  const [frei, setFrei] = useState<{ top: number; left: number } | null>(null)

  const stil = normalizeDrawingStyle(
    drawing.style,
    drawing.type === 'fib' || drawing.type === 'fibext'
      ? CHART_COLORS.warning
      : CHART_COLORS.accent,
  )

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (w && h && (Math.abs(w - breite) > 1 || Math.abs(h - hoehe) > 1)) {
      setMasse({ breite: w, hoehe: h })
    }
  }, [breite, hoehe, drawing.type])

  // Eine neue Zeichnung ist eine neue Lage: Der von Hand gewählte Platz gilt
  // für die Auswahl, an der er gewählt wurde.
  useEffect(() => {
    setFrei(null)
    setOffen(null)
    setGesichert(false)
  }, [drawing.id])

  // Klappe zu bei Klick daneben und bei Esc. Ohne das bliebe die Farbpalette
  // offen stehen und verdeckte den Chart.
  useEffect(() => {
    if (offen == null) return
    const zu = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      setOffen(null)
    }
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOffen(null)
    }
    window.addEventListener('pointerdown', zu, true)
    window.addEventListener('keydown', taste)
    return () => {
      window.removeEventListener('pointerdown', zu, true)
      window.removeEventListener('keydown', taste)
    }
  }, [offen])

  const setzen = useCallback(
    (teil: Partial<DrawingStyle>) => {
      setGesichert(false)
      onChange({ ...(drawing.style ?? {}), ...teil })
    },
    [drawing.style, onChange],
  )

  const pos = frei ?? lage(rahmen, breite, hoehe)

  /** Ziehen am Griff. */
  const griffDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const start = pos
    const bewegen = (ev: PointerEvent) => {
      setFrei({
        left: klemmen(8, start.left + ev.clientX - startX, window.innerWidth - breite - 8),
        top: klemmen(8, start.top + ev.clientY - startY, window.innerHeight - hoehe - 8),
      })
    }
    const los = () => {
      window.removeEventListener('pointermove', bewegen)
      window.removeEventListener('pointerup', los)
    }
    window.addEventListener('pointermove', bewegen)
    window.addEventListener('pointerup', los)
  }

  const klappe = (welche: Exclude<OffeneKlappe, null>) =>
    setOffen((o) => (o === welche ? null : welche))

  return createPortal(
    <div
      ref={ref}
      className="panel-raised flex items-center gap-0.5 p-1"
      style={{
        // `position` MUSS inline stehen — siehe Kopf dieser Datei.
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 50,
      }}
    >
      <span
        onPointerDown={griffDown}
        title="Leiste verschieben"
        className="flex h-7 w-3 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </span>

      {/* Farbe */}
      <div className="relative">
        <Knopf titel="Farbe" aktiv={offen === 'farbe'} onClick={() => klappe('farbe')}>
          <span
            className="size-4 rounded-full border border-border/60"
            style={{ background: stil.color }}
          />
        </Knopf>
        {offen === 'farbe' && (
          <Klappe>
            <div className="grid grid-cols-3 gap-1.5">
              {ZEICHEN_FARBEN.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  title={f.label}
                  aria-label={f.label}
                  onClick={() => {
                    setzen({ color: f.wert })
                    setOffen(null)
                  }}
                  className={`size-5 rounded-full border-2 transition-transform hover:scale-110 ${
                    stil.color.toLowerCase() === f.wert.toLowerCase()
                      ? 'border-foreground'
                      : 'border-transparent'
                  }`}
                  style={{ background: f.wert }}
                />
              ))}
            </div>
          </Klappe>
        )}
      </div>

      {/* Stärke */}
      <div className="relative">
        <Knopf titel="Stärke" aktiv={offen === 'staerke'} onClick={() => klappe('staerke')}>
          <span className="flex size-4 flex-col justify-center gap-[3px]">
            <span className="h-px w-full rounded-full bg-current" />
            <span className="h-[2px] w-full rounded-full bg-current" />
            <span className="h-[3px] w-full rounded-full bg-current" />
          </span>
        </Knopf>
        {offen === 'staerke' && (
          <Klappe>
            <div className="flex flex-col gap-0.5">
              {ZEICHEN_STAERKEN.map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-label={`Stärke ${w}`}
                  onClick={() => {
                    setzen({ width: w })
                    setOffen(null)
                  }}
                  className={`flex h-6 w-20 items-center justify-center rounded px-2 ${
                    stil.width === w ? 'bg-accent/25' : 'hover:bg-accent/10'
                  }`}
                >
                  <span
                    className="w-full rounded-full"
                    style={{ height: Math.max(1, w), background: stil.color }}
                  />
                </button>
              ))}
            </div>
          </Klappe>
        )}
      </div>

      {/* Strichart — TradingViews „Style". */}
      <div className="relative">
        <Knopf titel="Strichart" aktiv={offen === 'strich'} onClick={() => klappe('strich')}>
          <svg viewBox="0 0 16 16" className="size-4">
            <line
              x1={1}
              y1={8}
              x2={15}
              y2={8}
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeDasharray={strichMuster(stil.strich, 1.6)}
            />
          </svg>
        </Knopf>
        {offen === 'strich' && (
          <Klappe>
            <div className="flex flex-col gap-0.5">
              {STRICHARTEN.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-label={STRICH_NAMEN[s]}
                  title={STRICH_NAMEN[s]}
                  onClick={() => {
                    setzen(strichSetzen(s))
                    setOffen(null)
                  }}
                  className={`flex h-6 w-20 items-center rounded px-2 ${
                    stil.strich === s ? 'bg-accent/25' : 'hover:bg-accent/10'
                  }`}
                >
                  <svg viewBox="0 0 64 8" className="h-2 w-full" preserveAspectRatio="none">
                    <line
                      x1={0}
                      y1={4}
                      x2={64}
                      y2={4}
                      stroke={stil.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeDasharray={strichMuster(s, 2)}
                    />
                  </svg>
                </button>
              ))}
            </div>
          </Klappe>
        )}
      </div>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-border/50" />

      <Knopf titel="Einstellungen" onClick={onOpenSettings}>
        <Settings2 className="size-4" />
      </Knopf>

      <Knopf
        titel={locked ? 'Zeichnungen entsperren' : 'Zeichnungen sperren'}
        aktiv={locked}
        onClick={() => onLockedChange(!locked)}
      >
        {locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </Knopf>

      <button
        type="button"
        title="Zeichnung löschen (Entf)"
        aria-label="Zeichnung löschen"
        onClick={onDelete}
        className="flex size-7 shrink-0 items-center justify-center rounded text-destructive transition-colors hover:bg-destructive/15"
      >
        <Trash2 className="size-4" />
      </button>

      {/* Mehr */}
      <div className="relative">
        <Knopf titel="Mehr" aktiv={offen === 'mehr'} onClick={() => klappe('mehr')}>
          <MoreHorizontal className="size-4" />
        </Knopf>
        {offen === 'mehr' && (
          <Klappe>
            <div className="flex w-52 flex-col gap-0.5">
              {onClone && (
                <MehrEintrag
                  onClick={() => {
                    onClone()
                    setOffen(null)
                  }}
                  kuerzel="Strg+D"
                >
                  <Copy className="size-3.5" />
                  Klonen
                </MehrEintrag>
              )}
              {onSaveDefault && (
                <MehrEintrag
                  onClick={() => {
                    onSaveDefault(stil.color, stil.width)
                    setGesichert(true)
                  }}
                >
                  <span className="w-3.5 text-center">{gesichert ? '✓' : '★'}</span>
                  {gesichert ? 'als Standard gesichert' : 'Farbe & Stärke als Standard'}
                </MehrEintrag>
              )}
              <MehrEintrag
                onClick={() => {
                  onOpenSettings()
                  setOffen(null)
                }}
              >
                <Settings2 className="size-3.5" />
                Alle Eigenschaften …
              </MehrEintrag>
            </div>
          </Klappe>
        )}
      </div>
    </div>,
    document.body,
  )
}

const STRICH_NAMEN: Record<Strichart, string> = {
  solid: 'durchgezogen',
  dashed: 'gestrichelt',
  dotted: 'gepunktet',
}

function MehrEintrag({
  onClick,
  kuerzel,
  children,
}: {
  onClick: () => void
  kuerzel?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent/15 hover:text-foreground"
    >
      {children}
      {kuerzel && <span className="ml-auto text-[10px] opacity-60">{kuerzel}</span>}
    </button>
  )
}
