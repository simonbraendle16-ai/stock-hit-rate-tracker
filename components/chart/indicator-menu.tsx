'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, SlidersHorizontal, X } from 'lucide-react'
import {
  INDICATOR_DEFS,
  createInstance,
  type IndicatorConfig,
  type IndicatorInstance,
  type IndicatorType,
} from './indicators'

/** Periode-/Faktor-Eingabe: klemmt auf min–max, ignoriert Unlesbares. */
function ParamInput({
  value,
  onChange,
  label,
  min = 2,
  max = 400,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      title={label}
      aria-label={label}
      onBlur={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
        else e.target.value = String(value)
      }}
      className="h-6 w-14 px-1.5 font-mono text-[11px]"
    />
  )
}

/**
 * Indikator-Menü (AP 7 → AP 10/S5): beliebig viele Instanzen (z. B. EMA 20+50+200),
 * Kategorien + Suche wie TradingView — bewusst kein Buy/Sell-Rating
 * (Douglas-Leitplanke).
 */
export function IndicatorMenu({
  config,
  onChange,
}: {
  config: IndicatorConfig
  onChange: (cfg: IndicatorConfig) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Außenklick + Escape schließen das Panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const instances = config.instances
  const activeCount = instances.length

  const addInstance = (type: IndicatorType) => {
    onChange({ instances: [...instances, createInstance(type, instances)] })
  }
  const removeInstance = (id: string) => {
    onChange({ instances: instances.filter((i) => i.id !== id) })
  }
  const updateParam = (inst: IndicatorInstance, key: string, value: number) => {
    onChange({
      instances: instances.map((i) =>
        i.id === inst.id ? { ...i, params: { ...i.params, [key]: value } } : i,
      ),
    })
  }

  // Katalog nach Kategorie, gefiltert über die Suche.
  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCat = new Map<string, { type: IndicatorType; label: string }[]>()
    for (const [type, def] of Object.entries(INDICATOR_DEFS) as [IndicatorType, (typeof INDICATOR_DEFS)[IndicatorType]][]) {
      if (q && !def.label.toLowerCase().includes(q) && !type.includes(q)) continue
      const list = byCat.get(def.category) ?? []
      list.push({ type, label: def.label })
      byCat.set(def.category, list)
    }
    return byCat
  }, [query])

  return (
    <div ref={rootRef} className="relative">
      <Button
        size="sm"
        variant={activeCount > 0 ? 'secondary' : 'ghost'}
        className="h-7 px-2 font-mono text-[11px]"
        title="Indikatoren"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden sm:inline">Indikatoren{activeCount > 0 ? ` (${activeCount})` : ''}</span>
      </Button>

      {open && (
        <div className="glass-card absolute right-0 top-full z-30 mt-1 flex max-h-[70vh] w-80 flex-col p-3">
          <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Indikatoren — aus geladenen Kerzen berechnet
          </p>

          {instances.length > 0 && (
            <div className="mb-2 divide-y divide-border border-b border-border pb-2">
              {instances.map((inst) => {
                const def = INDICATOR_DEFS[inst.type]
                return (
                  <div key={inst.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-2 font-mono text-xs text-foreground">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ background: inst.color }}
                      />
                      {def.label}
                    </span>
                    <span className="flex items-center gap-1">
                      {def.params.map((pd) => (
                        <ParamInput
                          key={pd.key}
                          value={inst.params[pd.key] ?? pd.def}
                          label={`${def.label} ${pd.label}`}
                          min={pd.min ?? 2}
                          max={pd.max ?? 400}
                          step={pd.step ?? 1}
                          onChange={(v) => updateParam(inst, pd.key, v)}
                        />
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground"
                        title="Entfernen"
                        aria-label={`${def.label} entfernen`}
                        onClick={() => removeInstance(inst.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <Input
            placeholder="Indikator suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 h-7 font-mono text-xs"
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {Array.from(catalog.entries()).map(([cat, items]) => (
              <div key={cat} className="mb-1.5">
                <p className="px-1 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  {cat}
                </p>
                {items.map(({ type, label }) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="ghost"
                    className="h-7 w-full justify-start gap-2 px-2 font-mono text-[11px]"
                    onClick={() => addInstance(type)}
                  >
                    <Plus className="size-3 text-muted-foreground" />
                    {label}
                  </Button>
                ))}
              </div>
            ))}
            {catalog.size === 0 && (
              <p className="px-1 py-2 font-mono text-[11px] text-muted-foreground">
                Nichts gefunden.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
