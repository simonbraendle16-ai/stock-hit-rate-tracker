'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
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
  TrendingUp,
  Trash2,
  Type,
} from 'lucide-react'

export type DrawTool =
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'hline'
  | 'vline'
  | 'rect'
  | 'fib'
  | 'text'
  | 'measure'

const TOOLS: { id: DrawTool; label: string; icon?: React.ComponentType<{ className?: string }> }[] = [
  { id: 'cursor', label: 'Auswählen', icon: MousePointer2 },
  { id: 'trendline', label: 'Trendlinie', icon: TrendingUp },
  { id: 'ray', label: 'Strahl', icon: MoveUpRight },
  { id: 'hline', label: 'Horizontale Linie', icon: Minus },
  { id: 'vline', label: 'Vertikale Linie', icon: SeparatorVertical },
  { id: 'rect', label: 'Rechteck', icon: Square },
  { id: 'fib', label: 'Fib-Retracement' },
  { id: 'text', label: 'Notiz', icon: Type },
  { id: 'measure', label: 'Messen', icon: Ruler },
]

/**
 * Vertikale Zeichen-Tool-Leiste links am Chart (TradingView-Stil, AP 9):
 * Werkzeuge oben, darunter Magnet/Sichtbarkeit/Sperre, unten Löschen.
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

  const iconBtn = (
    key: string,
    label: string,
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
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
      {icon}
    </Button>
  )

  return (
    <div className="flex max-h-full w-9 shrink-0 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden border-r border-border pr-1">
      {TOOLS.map(({ id, label, icon: Icon }) =>
        iconBtn(
          id,
          label,
          tool === id,
          () => onToolChange(id),
          Icon ? <Icon className="size-4" /> : <span className="font-mono text-[9px] font-bold">Fib</span>,
        ),
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
          <Trash2 className="size-4" />
        ), 'text-destructive')}
      {hasDrawings &&
        iconBtn(
          'delall',
          confirmDeleteAll ? 'Wirklich ALLE löschen? Nochmal klicken' : 'Alle Zeichnungen löschen',
          confirmDeleteAll,
          handleDeleteAll,
          <Eraser className="size-4" />,
          confirmDeleteAll ? 'text-destructive animate-pulse' : 'text-muted-foreground',
        )}
    </div>
  )
}
