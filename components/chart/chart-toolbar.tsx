'use client'

import { Button } from '@/components/ui/button'
import {
  MousePointer2,
  Minus,
  TrendingUp,
  Type,
  Ruler,
  Trash2,
} from 'lucide-react'

export type DrawTool = 'cursor' | 'hline' | 'trendline' | 'fib' | 'text' | 'measure'

const TOOLS: { id: DrawTool; label: string; icon?: React.ComponentType<{ className?: string }> }[] = [
  { id: 'cursor', label: 'Auswählen', icon: MousePointer2 },
  { id: 'hline', label: 'Horizontallinie', icon: Minus },
  { id: 'trendline', label: 'Trendlinie', icon: TrendingUp },
  { id: 'fib', label: 'Fib-Retracement' },
  { id: 'text', label: 'Notiz', icon: Type },
  { id: 'measure', label: 'Messen', icon: Ruler },
]

export function ChartToolbar({
  tool,
  onToolChange,
  hasSelection,
  onDeleteSelected,
}: {
  tool: DrawTool
  onToolChange: (t: DrawTool) => void
  hasSelection: boolean
  onDeleteSelected: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          size="sm"
          variant={tool === id ? 'secondary' : 'ghost'}
          className="h-7 px-2 font-mono text-[11px]"
          title={label}
          onClick={() => onToolChange(id)}
        >
          {Icon ? <Icon className="size-3.5" /> : 'Fib'}
        </Button>
      ))}
      {hasSelection && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-destructive"
          title="Auswahl löschen (Entf)"
          onClick={onDeleteSelected}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  )
}
