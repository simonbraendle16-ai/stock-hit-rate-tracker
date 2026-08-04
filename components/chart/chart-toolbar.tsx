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
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  Ruler,
  SeparatorVertical,
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
      { id: 'hline', label: 'Horizontale Linie', icon: icon(Minus) },
      { id: 'vline', label: 'Vertikale Linie', icon: icon(SeparatorVertical) },
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
    ],
  },
  {
    name: 'Elliott',
    tools: [
      { id: 'ew_impulse', label: 'Elliott-Impuls 0-1-2-3-4-5 (6 Punkte)', icon: mono('1-5') },
      { id: 'ew_correction', label: 'Elliott-Korrektur 0-A-B-C (4 Punkte)', icon: mono('ABC') },
    ],
  },
  {
    name: 'Position',
    tools: [
      {
        id: 'longpos',
        label: 'Long-Position (Entry → Stop/Target, R:R)',
        icon: <TrendingUp className="size-4 text-positive" />,
      },
      {
        id: 'shortpos',
        label: 'Short-Position (Entry → Stop/Target, R:R)',
        icon: <TrendingDown className="size-4 text-destructive" />,
      },
    ],
  },
  {
    name: 'Notiz',
    tools: [{ id: 'text', label: 'Text/Notiz', icon: icon(Type) }],
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

/**
 * Vertikale Zeichen-Tool-Leiste links am Chart (TradingView-Stil, AP 9/10):
 * Cursor oben, Tool-Gruppen mit Flyout-Untermenüs, darunter Magnet/Sichtbarkeit/
 * Sperre, unten Löschen.
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

      {GROUPS.map((group) => {
        const current =
          group.tools.find((t) => t.id === groupChoice[group.name]) ?? group.tools[0]
        const groupActive = group.tools.some((t) => t.id === tool)
        const isOpen = openGroup?.name === group.name
        return (
          <Button
            key={group.name}
            size="sm"
            variant={groupActive ? 'secondary' : 'ghost'}
            className="h-8 w-8 shrink-0 p-0"
            title={group.tools.length > 1 ? `${group.name} — ${current.label}` : current.label}
            aria-label={group.name}
            onClick={(e) => {
              if (group.tools.length === 1) {
                selectTool(group.name, group.tools[0].id)
              } else if (isOpen) {
                setOpenGroup(null)
              } else {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                // Das Menü öffnet auf Höhe seines Knopfes — aber die unteren
                // Gruppen (Fibonacci, Elliott, Position, Notiz, Messen) liefen
                // damit unten aus dem Bild und waren praktisch nicht bedienbar.
                // Deshalb wird es am Fensterrand nach oben geschoben.
                const hoehe = FLYOUT_HEAD + group.tools.length * FLYOUT_ROW
                const platz = window.innerHeight - FLYOUT_MARGIN - hoehe
                setOpenGroup({
                  name: group.name,
                  top: Math.max(FLYOUT_MARGIN, Math.min(r.top, platz)),
                  left: r.right + 4,
                })
              }
            }}
          >
            {current.icon}
          </Button>
        )
      })}

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
            className="panel-raised z-50 flex w-64 flex-col gap-0.5 overflow-y-auto p-1.5"
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
            <p className="eyebrow px-2 py-1">{openGroup.name}</p>
            {GROUPS.find((g) => g.name === openGroup.name)?.tools.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={tool === t.id ? 'secondary' : 'ghost'}
                className="h-7 justify-start gap-2 px-2 font-mono text-[11px]"
                onClick={() => selectTool(openGroup.name, t.id)}
              >
                <span className="flex w-5 justify-center">{t.icon}</span>
                {t.label}
              </Button>
            ))}
          </div>,
          document.body,
        )}

      <div className="my-1 h-px w-5 bg-border" />

      {iconBtn('magnet', magnet ? 'Magnet aus' : 'Magnet: auf O/H/L/C snappen', magnet, () => onMagnetChange(!magnet), (
        <Magnet className="size-4" />
      ))}
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
