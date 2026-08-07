'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  ArrowUpRight,
  Brush,
  Circle,
  Delete,
  Eraser,
  Eye,
  EyeOff,
  Flag,
  Grid3x3,
  Lock,
  MessageSquare,
  Tag,
  LockOpen,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  Plus,
  Redo2,
  Ruler,
  Undo2,
  SeparatorVertical,
  LayoutGrid,
  Pin,
  Star,
  Square,
  TrendingDown,
  TrendingUp,
  Trash2,
  Type,
} from 'lucide-react'

export type DrawTool =
  | 'cursor'
  /** Radiergummi: Jeder Klick entfernt die getroffene Zeichnung. */
  | 'eraser'
  | 'trendline'
  | 'ray'
  | 'hline'
  | 'vline'
  | 'arrow'
  | 'channel'
  | 'rect'
  | 'ellipse'
  | 'brush'
  | 'fib'
  | 'fibext'
  | 'ew_impulse'
  | 'ew_correction'
  | 'longpos'
  | 'shortpos'
  | 'text'
  | 'measure'
  | 'pricerange'
  | 'daterange'
  | 'pitchfork'
  | 'gannbox'
  | 'fibfan'
  | 'fibtime'
  | 'fibcircle'
  | 'xabcd'
  | 'headshoulders'
  | 'pricelabel'
  | 'callout'
  | 'marker'
  | 'ew_triangle'
  | 'ew_double'
  | 'ew_triple'
  | 'infoline'
  | 'extendedline'
  | 'trendangle'
  | 'hray'
  | 'crossline'

/** Maße des Werkzeug-Flyouts — nur zum Einpassen ins Fenster. */
const FLYOUT_ROW = 30 // Höhe einer Zeile (h-7 + gap)
const FLYOUT_HEAD = 40 // Überschrift + Innenabstand
const FLYOUT_MARGIN = 8 // Mindestabstand zum Fensterrand

interface ToolDef {
  id: DrawTool
  label: string
  icon: React.ReactNode
}

const icon = (I: React.ComponentType<{ className?: string }>) => <I className="size-4" />
const mono = (s: string) => <span className="font-mono text-[8px] font-bold leading-none">{s}</span>

/** Tool-Gruppen wie in TradingView: Hauptknopf = zuletzt genutztes Tool der Gruppe. */
const GROUPS: { name: string; tools: ToolDef[] }[] = [
  {
    name: 'Linien',
    tools: [
      { id: 'trendline', label: 'Trendlinie', icon: icon(TrendingUp) },
      { id: 'ray', label: 'Strahl', icon: icon(MoveUpRight) },
      { id: 'infoline', label: 'Info-Linie (Kurs, %, Balken)', icon: mono('i—') },
      { id: 'extendedline', label: 'Verlängerte Gerade', icon: mono('↔') },
      { id: 'trendangle', label: 'Trendwinkel (mit Grad)', icon: mono('∠') },
      { id: 'hline', label: 'Horizontale Linie', icon: icon(Minus) },
      { id: 'hray', label: 'Horizontaler Strahl', icon: mono('—▸') },
      { id: 'vline', label: 'Vertikale Linie', icon: icon(SeparatorVertical) },
      { id: 'crossline', label: 'Fadenkreuz-Linie', icon: icon(Plus) },
      { id: 'arrow', label: 'Pfeil', icon: icon(ArrowUpRight) },
      { id: 'channel', label: 'Paralleler Kanal (3 Punkte)', icon: mono('∥') },
    ],
  },
  {
    name: 'Formen',
    tools: [
      { id: 'rect', label: 'Rechteck', icon: icon(Square) },
      { id: 'ellipse', label: 'Ellipse', icon: icon(Circle) },
      { id: 'brush', label: 'Freihand (Brush)', icon: icon(Brush) },
    ],
  },
  {
    name: 'Fibonacci',
    tools: [
      { id: 'fib', label: 'Fib-Retracement', icon: mono('Fib') },
      { id: 'fibext', label: 'Fib-Extension (3 Punkte)', icon: mono('FibE') },
      { id: 'fibfan', label: 'Fib-Fan (Strahlen)', icon: mono('Fan') },
      { id: 'fibtime', label: 'Fib-Zeitzonen', icon: mono('FibT') },
      { id: 'fibcircle', label: 'Fib-Kreise', icon: mono('FibO') },
    ],
  },
  {
    name: 'Muster',
    tools: [
      { id: 'ew_impulse', label: 'Elliott-Impuls 0–5 (6 Punkte)', icon: mono('1-5') },
      { id: 'ew_correction', label: 'Elliott-Korrektur A-B-C (4 Punkte)', icon: mono('ABC') },
      { id: 'ew_triangle', label: 'Elliott-Dreieck A-B-C-D-E (6 Punkte)', icon: mono('ABCDE') },
      { id: 'ew_double', label: 'Elliott-Doppelkombo W-X-Y (4 Punkte)', icon: mono('WXY') },
      { id: 'ew_triple', label: 'Elliott-Dreifachkombo W-X-Y-X-Z (6 P.)', icon: mono('WXYXZ') },
      { id: 'xabcd', label: 'XABCD-Muster (5 Punkte)', icon: mono('XABCD') },
      {
        id: 'headshoulders',
        label: 'Kopf-Schulter (7 Punkte)',
        icon: mono('KSK'),
      },
    ],
  },
  {
    name: 'Projektion',
    tools: [
      { id: 'pitchfork', label: "Andrews' Pitchfork (3 Punkte)", icon: mono('⋔') },
      { id: 'gannbox', label: 'Gann-Box (2 Punkte)', icon: icon(Grid3x3) },
    ],
  },
  {
    name: 'Position',
    tools: [
      {
        id: 'longpos',
        label: 'Long-Position (Entry/Stop/Ziel)',
        icon: <TrendingUp className="size-4 text-positive" />,
      },
      {
        id: 'shortpos',
        label: 'Short-Position (Entry/Stop/Ziel)',
        icon: <TrendingDown className="size-4 text-destructive" />,
      },
    ],
  },
  {
    name: 'Notiz',
    tools: [
      { id: 'text', label: 'Text/Notiz', icon: icon(Type) },
      { id: 'callout', label: 'Sprechblase mit Text', icon: icon(MessageSquare) },
      { id: 'pricelabel', label: 'Kurs-Etikett', icon: icon(Tag) },
      { id: 'marker', label: 'Marker/Fähnchen', icon: icon(Flag) },
    ],
  },
  {
    name: 'Messen',
    tools: [
      { id: 'measure', label: 'Messen (flüchtig)', icon: icon(Ruler) },
      { id: 'pricerange', label: 'Preis-Range (persistent)', icon: mono('P↕') },
      { id: 'daterange', label: 'Zeit-Range (persistent)', icon: mono('T↔') },
    ],
  },
]

/** Kennung des einen Werkzeug-Menüs (es gibt nur noch dieses). */
const ALLE = 'alle'

/** Alle Werkzeuge flach — für Favoritenleiste und Nachschlagen. */
const ALL_TOOLS: ToolDef[] = GROUPS.flatMap((g) => g.tools)
const TOOL_BY_ID = new Map(ALL_TOOLS.map((t) => [t.id as string, t]))

/**
 * Vertikale Zeichen-Tool-Leiste links am Chart (TradingView-Stil, AP 9/10):
 * Cursor oben, dann die FAVORITEN als direkte Knöpfe, darunter die Tool-Gruppen
 * mit Flyout-Untermenüs, dann Magnet/Sichtbarkeit/Sperre, unten Löschen.
 *
 * Die Favoritenleiste ist der Grund, warum die Leiste überhaupt umgebaut wurde:
 * Achtzehn Werkzeuge hinter sieben Gruppen bedeuten für jedes einzelne zwei
 * Griffe — Gruppe öffnen, Werkzeug wählen. Wer beim Lesen einer Struktur
 * zwischen Trendlinie, Niveau und Fib wechselt (also immer), ist damit dauernd
 * in der Leiste statt im Chart.
 */
export function ChartToolbar({
  tool,
  onToolChange,
  hasSelection,
  onDeleteSelected,
  magnet,
  onMagnetChange,
  locked,
  onLockedChange,
  drawingsVisible,
  onDrawingsVisibleChange,
  onDeleteAll,
  hasDrawings,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  favorites,
  onToggleFavorite,
  keepTool,
  onKeepToolChange,
}: {
  tool: DrawTool
  onToolChange: (t: DrawTool) => void
  hasSelection: boolean
  onDeleteSelected: () => void
  magnet: boolean
  onMagnetChange: (v: boolean) => void
  locked: boolean
  onLockedChange: (v: boolean) => void
  drawingsVisible: boolean
  onDrawingsVisibleChange: (v: boolean) => void
  onDeleteAll: () => void
  hasDrawings: boolean
  /**
   * Rückgängig/Wiederholen. Ohne sie muss jeder Strich beim ersten Mal sitzen
   * — dann probiert man nichts aus, und genau das Ausprobieren ist der Sinn
   * des Übens.
   */
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  /**
   * Die Werkzeuge der Favoritenleiste, in ihrer Reihenfolge. Kennungen, die
   * diese Leiste nicht kennt, werden übersprungen statt zu stören — die
   * gespeicherte Liste wird bewusst nicht gegen einen festen Bestand geprüft
   * (siehe `lib/chart-tools.ts`).
   */
  favorites: string[]
  onToggleFavorite: (id: DrawTool) => void
  /** Bleibt das Werkzeug nach einer fertigen Zeichnung aktiv? */
  keepTool: boolean
  onKeepToolChange: (v: boolean) => void
}) {
  // Zuletzt genutztes Tool je Gruppe (bestimmt das Icon des Gruppen-Knopfs).
  const [groupChoice, setGroupChoice] = useState<Record<string, DrawTool>>({})
  // Flyout liegt `fixed` (der Toolbar-Container scrollt/clippt sonst das Menü).
  const [openGroup, setOpenGroup] = useState<{ name: string; top: number; left: number } | null>(
    null,
  )
  const rootRef = useRef<HTMLDivElement>(null)
  /** Das Flyout liegt im Portal am <body> — es muss eigens geprüft werden. */
  const flyoutRef = useRef<HTMLDivElement>(null)

  // Klick außerhalb schließt das Flyout.
  useEffect(() => {
    if (!openGroup) return
    const onDown = (e: PointerEvent) => {
      const ziel = e.target as Node
      if (rootRef.current?.contains(ziel)) return
      if (flyoutRef.current?.contains(ziel)) return
      setOpenGroup(null)
    }
    const onScroll = () => setOpenGroup(null)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [openGroup])

  // „Alle löschen“ braucht zwei Klicks (Bestätigung), Auto-Reset nach 3 s.
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    },
    [],
  )

  const handleDeleteAll = () => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true)
      confirmTimer.current = setTimeout(() => setConfirmDeleteAll(false), 3000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setConfirmDeleteAll(false)
    onDeleteAll()
  }

  /**
   * Die Favoriten als echte Werkzeuge. Unbekannte Kennungen fallen hier still
   * heraus — gespeichert bleiben sie trotzdem, damit ein zurückgenommenes
   * Werkzeug die Liste des Nutzers nicht dauerhaft beschädigt.
   */
  const favoriten = favorites
    .map((id) => TOOL_BY_ID.get(id))
    .filter((t): t is ToolDef => t != null)

  const offen = openGroup != null

  const selectTool = (groupName: string, t: DrawTool) => {
    setGroupChoice((p) => ({ ...p, [groupName]: t }))
    setOpenGroup(null)
    onToolChange(t)
  }

  const iconBtn = (
    key: string,
    label: string,
    active: boolean,
    onClick: () => void,
    iconNode: React.ReactNode,
    className?: string,
  ) => (
    <Button
      key={key}
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      className={`h-8 w-8 p-0 ${className ?? ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {iconNode}
    </Button>
  )

  return (
    <div
      ref={rootRef}
      className="relative flex max-h-full w-9 shrink-0 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden border-r border-border pr-1"
    >
      {iconBtn('cursor', 'Auswählen', tool === 'cursor', () => onToolChange('cursor'), (
        <MousePointer2 className="size-4" />
      ))}

      {/* Rückgängig steht ganz oben, weil es beim Zeichnen der häufigste Griff
          nach dem Werkzeug selbst ist. Tastatur: Strg+Z / Strg+Umschalt+Z. */}
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0 disabled:opacity-30"
        title="Rückgängig (Strg+Z)"
        aria-label="Rückgängig"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0 disabled:opacity-30"
        title="Wiederholen (Strg+Umschalt+Z)"
        aria-label="Wiederholen"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="size-4" />
      </Button>

      {/* Radiergummi steht bewusst neben dem Cursor: Wegräumen ist beim
          Zeichnen genauso häufig wie Auswählen. Der Modus bleibt aktiv, bis
          man ihn wieder abwählt — mehrere Zeichnungen ohne Umweg entfernen. */}
      {iconBtn(
        'eraser',
        'Radiergummi — Klick entfernt die Zeichnung (nochmal klicken zum Beenden)',
        tool === 'eraser',
        () => onToolChange(tool === 'eraser' ? 'cursor' : 'eraser'),
        <Eraser className="size-4" />,
        tool === 'eraser' ? 'text-destructive' : undefined,
      )}

      {/* Die Favoriten: ein Griff statt zwei. Sie stehen oben, weil sie im
          Betrieb die meistbenutzten Knöpfe sind — direkt unter dem Zeiger. */}
      {favoriten.length > 0 && (
        <>
          <div className="my-1 h-px w-5 bg-border" />
          {favoriten.map((t) => (
            <Button
              key={`fav-${t.id}`}
              size="sm"
              variant={tool === t.id ? 'secondary' : 'ghost'}
              className="h-8 w-8 shrink-0 p-0"
              title={`${t.label} — Favorit (Rechtsklick entfernt ihn)`}
              aria-label={`${t.label} — Favorit`}
              onClick={() => onToolChange(t.id)}
              // Dritter Weg: Rechtsklick nimmt den Favoriten wieder heraus, ohne
              // den Umweg über das Menü.
              onContextMenu={(e) => {
                e.preventDefault()
                onToggleFavorite(t.id)
              }}
            >
              {t.icon}
            </Button>
          ))}
        </>
      )}

      <div className="my-1 h-px w-5 bg-border" />

      {/* EIN Knopf für alle Werkzeuge statt sieben Gruppenknöpfe.
          Grund: Mit der Favoritenleiste darüber wurde die Leiste länger als
          jeder Chart hoch ist — Magnet, Sperre und Löschen lagen unterhalb des
          Bildes und waren nur noch durch Scrollen erreichbar. Für ein
          nicht-favorisiertes Werkzeug sind es weiterhin zwei Griffe, also kein
          Verlust; alles, was man oft braucht, liegt jetzt als Favorit oben. */}
      <Button
        size="sm"
        variant={offen ? 'secondary' : 'ghost'}
        className="h-8 w-8 shrink-0 p-0"
        title="Alle Werkzeuge — Stern setzt einen Favoriten"
        aria-label="Alle Werkzeuge"
        aria-expanded={offen}
        onClick={(e) => {
          if (offen) {
            setOpenGroup(null)
            return
          }
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          // Das Menü öffnet auf Höhe seines Knopfes, wird am unteren
          // Fensterrand aber nach oben geschoben — sonst liefe es aus dem Bild.
          const hoehe = FLYOUT_HEAD + (ALL_TOOLS.length + GROUPS.length) * FLYOUT_ROW
          const platz = window.innerHeight - FLYOUT_MARGIN - hoehe
          setOpenGroup({
            name: ALLE,
            top: Math.max(FLYOUT_MARGIN, Math.min(r.top, platz)),
            left: r.right + 4,
          })
        }}
      >
        <LayoutGrid className="size-4" />
      </Button>

      {/* Das Flyout hängt am <body>, NICHT hier im Baum.
          Grund: Die Chart-Karte trägt `.rise-in`, und deren `transform` bleibt
          auch nach der Animation stehen (`matrix(1,0,0,1,0,0)`). Ein Element
          mit transform wird zum Bezugsrahmen für `position: fixed` — die
          Menüs richteten sich also nach der Karte statt nach dem Fenster und
          landeten weit unterhalb ihres Knopfes. Wer hier künftig `fixed`
          benutzt, muss denselben Weg gehen. */}
      {openGroup &&
        createPortal(
          <div
            ref={flyoutRef}
            // Zwei Spalten: Einspaltig war das Menü mit 33 Werkzeugen fast 900 px
            // hoch und füllte damit das ganze Fenster — man sah nie die Struktur,
            // sondern immer nur einen Ausschnitt, und der Stern rechts am Eintrag
            // ging darin unter.
            className="panel-raised z-50 grid w-[36rem] grid-cols-2 gap-x-2 gap-y-0.5 overflow-y-auto p-2"
            style={{
              // `position` MUSS inline stehen: In `globals.css` gilt
              // `body > * { position: relative }`, und diese Regel liegt
              // außerhalb der Tailwind-Layer — ungelayertes CSS gewinnt gegen
              // gelayerte Utilities unabhängig von der Spezifität. Die Klasse
              // `fixed` wurde deshalb überstimmt, und `top` zählte plötzlich
              // als Fluss-Versatz: Das Menü landete rund 1200 px zu tief.
              position: 'fixed',
              top: openGroup.top,
              left: openGroup.left,
              maxHeight: `calc(100vh - ${openGroup.top + FLYOUT_MARGIN}px)`,
            }}
          >
            <div className="col-span-2 mb-1 flex items-center gap-2 px-1">
              <p className="eyebrow">Werkzeuge</p>
              <span className="grow" />
              {/* Der Hinweis stand vorher klein und grau ganz oben und wurde
                  überlesen — deshalb steht er jetzt mit dem Symbol daneben, das
                  er erklärt. */}
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                <Star className="size-3.5 text-warning" />
                anklicken = in die Favoritenleiste
              </span>
            </div>
            {GROUPS.flatMap((g) => [
              <p key={`h-${g.name}`} className="col-span-2 eyebrow px-1 pb-0.5 pt-2 opacity-70">
                {g.name}
              </p>,
              ...g.tools.map((t) => {
              const istFavorit = favorites.includes(t.id)
              return (
                // Zwei Schaltflächen nebeneinander, nicht eine mit Stern darin:
                // Ein Stern INNERHALB des Werkzeug-Knopfes würde beim Anklicken
                // auch das Werkzeug wählen und das Menü schließen — man käme
                // nie zum Setzen des Sterns.
                <div
                  key={t.id}
                  className="flex items-center gap-0.5"
                  // Zweiter Weg: Rechtsklick irgendwo auf der Zeile schaltet den
                  // Favoriten. Ein einziger 14-px-Stern am rechten Rand war zu
                  // wenig — er wurde schlicht nicht gefunden.
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onToggleFavorite(t.id)
                  }}
                >
                  <Button
                    size="sm"
                    variant={tool === t.id ? 'secondary' : 'ghost'}
                    className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 font-mono text-[11px]"
                    onClick={() => selectTool(g.name, t.id)}
                  >
                    <span className="flex w-5 shrink-0 justify-center">{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    // Größer, mit sichtbarem Rahmen und im gesetzten Zustand
                    // kräftig gefüllt: Der Stern ist jetzt ein Bedienelement und
                    // keine Verzierung mehr.
                    className={`h-8 w-8 shrink-0 rounded border p-0 ${
                      istFavorit
                        ? 'border-warning/60 bg-warning/10'
                        : 'border-border/60 hover:border-warning/60'
                    }`}
                    title={istFavorit ? 'Aus den Favoriten nehmen' : 'Zu den Favoriten'}
                    aria-label={istFavorit ? 'Aus den Favoriten nehmen' : 'Zu den Favoriten'}
                    aria-pressed={istFavorit}
                    onClick={(e) => {
                      // Das Menü bleibt offen: Wer Favoriten legt, legt meist
                      // mehrere.
                      e.stopPropagation()
                      onToggleFavorite(t.id)
                    }}
                  >
                    <Star
                      className={`size-4 ${
                        istFavorit
                          ? 'fill-warning text-warning'
                          : 'text-muted-foreground/70'
                      }`}
                    />
                  </Button>
                </div>
              )
              }),
            ])}
          </div>,
          document.body,
        )}

      <div className="my-1 h-px w-5 bg-border" />

      {iconBtn('magnet', magnet ? 'Magnet aus' : 'Magnet: auf O/H/L/C snappen', magnet, () => onMagnetChange(!magnet), (
        <Magnet className="size-4" />
      ))}
      {/* Ohne diesen Schalter sprang das Werkzeug nach JEDER Zeichnung zurück
          auf den Zeiger — fünf Niveaus einzeichnen hieß fünfmal in die Leiste
          greifen. */}
      {iconBtn(
        'keep',
        keepTool
          ? 'Werkzeug bleibt aktiv — abschalten (springt dann nach jeder Zeichnung zurück)'
          : 'Werkzeug nach dem Zeichnen aktiv lassen',
        keepTool,
        () => onKeepToolChange(!keepTool),
        <Pin className="size-4" />,
      )}
      {iconBtn(
        'visible',
        drawingsVisible ? 'Zeichnungen ausblenden' : 'Zeichnungen einblenden',
        false,
        () => onDrawingsVisibleChange(!drawingsVisible),
        drawingsVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />,
      )}
      {iconBtn(
        'lock',
        locked ? 'Zeichnungen entsperren' : 'Zeichnungen sperren',
        locked,
        () => onLockedChange(!locked),
        locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />,
      )}

      <div className="my-1 h-px w-5 bg-border" />

      {hasSelection &&
        iconBtn('del', 'Auswahl löschen (Entf)', false, onDeleteSelected, (
          <Delete className="size-4" />
        ), 'text-destructive')}
      {hasDrawings &&
        iconBtn(
          'delall',
          confirmDeleteAll ? 'Wirklich ALLE löschen? Nochmal klicken' : 'Alle Zeichnungen löschen',
          confirmDeleteAll,
          handleDeleteAll,
          <Trash2 className="size-4" />,
          confirmDeleteAll ? 'text-destructive animate-pulse' : 'text-muted-foreground',
        )}
    </div>
  )
}
