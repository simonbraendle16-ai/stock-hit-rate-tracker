'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SlidersHorizontal } from 'lucide-react'
import type { IndicatorConfig } from './indicators'

/** Periode-Eingabe: klemmt auf 2–400, ignoriert Unlesbares. */
function PeriodInput({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (v: number) => void
  label: string
}) {
  return (
    <Input
      type="number"
      min={2}
      max={400}
      defaultValue={value}
      title={label}
      aria-label={label}
      onBlur={(e) => {
        const n = Math.round(Number(e.target.value))
        if (Number.isFinite(n)) onChange(Math.max(2, Math.min(400, n)))
        else e.target.value = String(value)
      }}
      className="h-6 w-14 px-1.5 font-mono text-[11px]"
    />
  )
}

/**
 * Indikator-Menü (AP 7): nüchterne Toggle-Liste mit einstellbaren Perioden —
 * bewusst kein Buy/Sell-Rating (Douglas-Leitplanke).
 */
export function IndicatorMenu({
  config,
  onChange,
}: {
  config: IndicatorConfig
  onChange: (cfg: IndicatorConfig) => void
}) {
  const [open, setOpen] = useState(false)
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

  const activeCount = [config.ema.on, config.sma.on, config.volume.on, config.rsi.on, config.macd.on].filter(
    Boolean,
  ).length

  const row = (label: string, on: boolean, toggle: (v: boolean) => void, controls?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-foreground">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        {label}
      </label>
      <div className="flex items-center gap-1">{controls}</div>
    </div>
  )

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
        <div className="glass-card absolute right-0 top-full z-30 mt-1 w-72 p-3">
          <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Indikatoren — aus geladenen Kerzen berechnet
          </p>
          <div className="divide-y divide-border">
            {row('EMA', config.ema.on, (v) => onChange({ ...config, ema: { ...config.ema, on: v } }), (
              <PeriodInput
                value={config.ema.period}
                label="EMA-Periode"
                onChange={(period) => onChange({ ...config, ema: { ...config.ema, period } })}
              />
            ))}
            {row('SMA', config.sma.on, (v) => onChange({ ...config, sma: { ...config.sma, on: v } }), (
              <PeriodInput
                value={config.sma.period}
                label="SMA-Periode"
                onChange={(period) => onChange({ ...config, sma: { ...config.sma, period } })}
              />
            ))}
            {row('Volumen', config.volume.on, (v) => onChange({ ...config, volume: { on: v } }))}
            {row('RSI', config.rsi.on, (v) => onChange({ ...config, rsi: { ...config.rsi, on: v } }), (
              <PeriodInput
                value={config.rsi.period}
                label="RSI-Periode"
                onChange={(period) => onChange({ ...config, rsi: { ...config.rsi, period } })}
              />
            ))}
            {row('MACD', config.macd.on, (v) => onChange({ ...config, macd: { ...config.macd, on: v } }), (
              <>
                <PeriodInput
                  value={config.macd.fast}
                  label="MACD schnell"
                  onChange={(fast) => onChange({ ...config, macd: { ...config.macd, fast } })}
                />
                <PeriodInput
                  value={config.macd.slow}
                  label="MACD langsam"
                  onChange={(slow) => onChange({ ...config, macd: { ...config.macd, slow } })}
                />
                <PeriodInput
                  value={config.macd.signal}
                  label="MACD Signal"
                  onChange={(signal) => onChange({ ...config, macd: { ...config.macd, signal } })}
                />
              </>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
