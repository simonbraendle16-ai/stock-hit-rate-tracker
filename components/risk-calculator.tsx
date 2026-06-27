'use client'

import { useState } from 'react'
import { AlertTriangle, Calculator, DollarSign, TrendingUp } from 'lucide-react'

export function RiskCalculator() {
  const [capital, setCapital] = useState('')
  const [riskPct, setRiskPct] = useState('1')
  const [entry, setEntry] = useState('')
  const [stopLoss, setStopLoss] = useState('')

  const cap = parseFloat(capital)
  const rPct = parseFloat(riskPct)
  const ent = parseFloat(entry)
  const sl = parseFloat(stopLoss)

  let result: { riskAmount: string; positionSize: string; positionValue: string } | null = null
  if (cap && rPct && ent && sl && ent !== sl) {
    const riskAmount = cap * (rPct / 100)
    const priceDiff = Math.abs(ent - sl)
    const positionSize = riskAmount / priceDiff
    result = {
      riskAmount: riskAmount.toFixed(2),
      positionSize: positionSize.toFixed(4),
      positionValue: (positionSize * ent).toFixed(2),
    }
  }

  const inputCls =
    'w-full border-0 border-b border-border bg-transparent py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary/50'

  return (
    <div className="glass-card h-full overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <Calculator className="size-4 text-primary" />
        </div>
        <div>
          <h3 className="font-heading text-xs font-bold tracking-widest text-foreground">
            RISK CALCULATOR
          </h3>
          <p className="mt-0.5 font-mono text-[9px] text-primary/40">Positionsgröße berechnen</p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="font-mono text-[9px] tracking-widest text-primary/45">
              <DollarSign className="mr-1 inline size-2.5" />
              KAPITAL
            </label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              placeholder="10000"
              className={inputCls}
            />
          </div>
          <div>
            <label className="font-mono text-[9px] tracking-widest text-warning/70">
              <AlertTriangle className="mr-1 inline size-2.5" />
              RISIKO %
            </label>
            <input
              type="number"
              step="0.1"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
              placeholder="1"
              className={inputCls}
            />
          </div>
          <div>
            <label className="font-mono text-[9px] tracking-widest text-positive/70">EINSTIEG</label>
            <input
              type="number"
              step="any"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="150.00"
              className={inputCls}
            />
          </div>
          <div>
            <label className="font-mono text-[9px] tracking-widest text-destructive/70">
              STOP-LOSS
            </label>
            <input
              type="number"
              step="any"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="145.00"
              className={inputCls}
            />
          </div>
        </div>

        {result ? (
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Bubble label="RISIKO (€)" value={result.riskAmount} tone="text-warning" />
            <Bubble label="POSITION" value={result.positionSize} tone="text-primary" />
            <Bubble label="WERT (€)" value={result.positionValue} tone="text-positive" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-primary/15 bg-primary/[0.03] p-3 text-center">
            <TrendingUp className="mx-auto mb-1 size-4 text-primary/25" />
            <p className="font-mono text-[10px] text-primary/30">Felder ausfüllen →</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Bubble({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2.5 text-center">
      <p className="mb-1 font-mono text-[8px] tracking-widest text-muted-foreground">{label}</p>
      <p className={`font-heading text-sm font-bold ${tone}`}>{value}</p>
    </div>
  )
}
