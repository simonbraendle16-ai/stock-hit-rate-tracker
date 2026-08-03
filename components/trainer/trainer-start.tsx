'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Field, FormSection, ChoiceButton, InlineNotice } from '@/components/form-frame'
import { startTrainingSession } from '@/app/actions/training'
import { CHART_TIMEFRAME_IDS } from '@/lib/chart-timeframes'
import { TRAINING_MODES, type TrainingMode } from '@/lib/training'
import { AlertTriangle, Play } from 'lucide-react'

const MARKETS = [
  { value: 'aktien', label: 'Aktien' },
  { value: 'krypto', label: 'Krypto' },
  { value: 'rohstoffe', label: 'Rohstoffe' },
  { value: 'etf', label: 'ETF' },
  { value: 'sonstiges', label: 'Sonstiges' },
]

/** Tage lesbar machen — Wochen und Monate sagen mehr als dreistellige Tage. */
function spanne(days: number): string {
  if (days >= 365) {
    const jahre = days / 365
    return `${jahre.toFixed(jahre >= 10 ? 0 : 1).replace('.', ',')} J`
  }
  if (days >= 60) return `${Math.round(days / 30)} Mon`
  return `${days} T`
}

/**
 * Der Einstieg in eine Übung. Im Zufalls- und im Elliott-Modus fehlen Symbol
 * und Markt bewusst: Das Instrument zieht der Server, damit der Browser es bei
 * einer verdeckten Übung gar nicht erst erfährt.
 */
export function TrainerStart({
  initialSymbol = '',
  initialMarket = 'aktien',
  coverage = [],
}: {
  initialSymbol?: string
  initialMarket?: string
  /** Gespeicherte Historie je Zeitebene (Kerzenspeicher). */
  coverage?: { timeframe: string; days: number; symbols: number; candles: number }[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<TrainingMode>(initialSymbol ? 'frei' : 'zufall')
  const [symbol, setSymbol] = useState(initialSymbol)
  const [market, setMarket] = useState(initialMarket)
  const [timeframe, setTimeframe] = useState('1h')
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const gesamtKerzen = coverage.reduce((s, c) => s + c.candles, 0)

  function start() {
    setFehler(null)
    startTransition(async () => {
      const res = await startTrainingSession({ mode, symbol, market, timeframe })
      if ('error' in res) {
        setFehler(res.error)
        return
      }
      router.push(`/trainer/${res.id}`)
    })
  }

  return (
    <FormSection
      icon={Play}
      title="Neue Übung"
      hint="Analysieren, festschreiben, aufdecken, bewerten — in dieser Reihenfolge."
    >
      <Field label="Art der Übung" as="div">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TRAINING_MODES.map((m) => (
            <ChoiceButton
              key={m.id}
              active={mode === m.id}
              onClick={() => setMode(m.id)}
              className="py-3"
            >
              {m.label}
            </ChoiceButton>
          ))}
        </div>
        <p className="note">{TRAINING_MODES.find((m) => m.id === mode)!.hint}</p>
      </Field>

      {mode === 'frei' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Symbol" hint="Watchlist-Ticker oder frei, z. B. AAPL, BTC-USD, SAP.DE.">
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="font-mono text-xs uppercase"
            />
          </Field>
          <Field label="Markt">
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="input-ocean h-9 w-full rounded-lg px-2.5 font-mono text-xs"
            >
              {MARKETS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <Field label="Zeitebene" as="div" hint="Steht für die ganze Übung fest.">
        <div className="flex flex-wrap gap-1">
          {CHART_TIMEFRAME_IDS.map((tf) => {
            const abdeckung = coverage.find((c) => c.timeframe === tf)
            return (
              <Button
                key={tf}
                size="sm"
                variant={tf === timeframe ? 'secondary' : 'ghost'}
                className="h-auto flex-col gap-0 px-2.5 py-1 font-mono text-xs"
                onClick={() => setTimeframe(tf)}
              >
                <span>{tf}</span>
                {/* Die tatsächliche Reichweite statt eines allgemeinen Satzes
                    über den Anbieter — man sieht sofort, ob 15m schon lohnt. */}
                <span className="text-[9px] font-normal text-muted-foreground">
                  {abdeckung && abdeckung.days > 0 ? spanne(abdeckung.days) : '—'}
                </span>
              </Button>
            )
          })}
        </div>
      </Field>

      {fehler && (
        <InlineNotice tone="warning" icon={AlertTriangle}>
          {fehler}
        </InlineNotice>
      )}

      <Button onClick={start} disabled={pending} className="w-full gap-2 font-mono">
        <Play className="size-4" />
        {pending ? 'Wird vorbereitet ...' : 'Übung starten'}
      </Button>

      <p className="note">
        {gesamtKerzen > 0 ? (
          <>
            Unter jeder Zeitebene steht, wie weit der eigene Kerzenspeicher zurückreicht
            ({gesamtKerzen.toLocaleString('de-DE')} Kerzen). Er wächst mit jedem Abruf und
            mit dem täglichen Sammellauf — auch über das hinaus, was Yahoo noch hergibt
            (dort enden 15-Minuten-Kerzen nach 60 Tagen).
          </>
        ) : (
          <>
            Der Kerzenspeicher ist noch leer — die Reichweite je Zeitebene erscheint, sobald
            zum ersten Mal Kerzen geholt wurden. Ab dann wächst er weiter, auch über Yahoos
            Fenster hinaus (dort enden 15-Minuten-Kerzen nach 60 Tagen).
          </>
        )}
      </p>
    </FormSection>
  )
}
