'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Lock,
  Pause,
  Play,
  RotateCcw,
  StepBack,
  StepForward,
} from 'lucide-react'

/** Abspielgeschwindigkeiten in Millisekunden je Kerze. */
const SPEEDS = [
  { label: '0,5×', ms: 1300 },
  { label: '1×', ms: 650 },
  { label: '2×', ms: 300 },
  { label: '4×', ms: 130 },
]

export function ChartReplayControls({
  total,
  visible,
  onChange,
  start,
  maxVisible,
  lockedHint,
}: {
  total: number
  visible: number
  onChange: (visible: number) => void
  /**
   * Der Startpunkt der Übung — das Ziel von „Zurücksetzen". Ohne Angabe die
   * Stelle, an der ein freier Replay üblicherweise beginnt.
   */
  start?: number
  /**
   * Obergrenze der sichtbaren Kerzen. Der Trainer setzt sie vor dem
   * Festschreiben auf den Startpunkt: Wer die Zukunft schon gesehen hat,
   * schreibt keine These mehr fest, sondern eine Erinnerung.
   */
  maxVisible?: number
  /** Erklärt, warum die Grenze steht (erscheint anstelle der Zählung). */
  lockedHint?: string
}) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const min = Math.min(total, 30)
  const canReplay = total > min
  const cap = Math.min(total, Math.max(min, maxVisible ?? total))
  const current = Math.min(Math.max(visible, min), Math.max(cap, min))
  const startAt = Math.min(cap, Math.max(min, start ?? Math.round(total * 0.62)))
  const future = Math.max(0, total - current)
  const atCap = current >= cap
  const gesperrt = cap < total

  useEffect(() => {
    if (!playing || !canReplay) return
    if (current >= cap) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => onChange(Math.min(cap, current + 1)), SPEEDS[speed].ms)
    return () => clearTimeout(timer)
  }, [playing, canReplay, current, cap, onChange, speed])

  useEffect(() => {
    if (current >= cap) setPlaying(false)
  }, [current, cap])

  if (!canReplay) {
    return (
      <div className="panel-sunken mb-3 px-3 py-2">
        <p className="note">
          Replay braucht mehr Kerzen. Wähle ein anderes Symbol oder eine größere Zeitebene.
        </p>
      </div>
    )
  }

  const set = (next: number) => onChange(Math.min(cap, Math.max(min, next)))

  return (
    <div className="panel-sunken mb-3 flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="flex items-center gap-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="10 Kerzen zurück"
          onClick={() => set(current - 10)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Eine Kerze zurück"
          onClick={() => set(current - 1)}
        >
          <StepBack className="size-4" />
        </Button>
        <Button
          size="sm"
          variant={playing ? 'secondary' : 'ghost'}
          className="h-8 w-8 p-0"
          disabled={atCap}
          title={playing ? 'Pause' : 'Abspielen'}
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={atCap}
          title="Nächste Kerze"
          onClick={() => set(current + 1)}
        >
          <StepForward className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={atCap}
          title="10 Kerzen vor"
          onClick={() => set(current + 10)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Zurück zum Startpunkt"
          onClick={() => {
            setPlaying(false)
            set(startAt)
          }}
        >
          <RotateCcw className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 px-2 font-mono text-[11px]"
          disabled={atCap}
          title="Alle Kerzen anzeigen"
          onClick={() => {
            setPlaying(false)
            set(cap)
          }}
        >
          <ChevronsRight className="size-4" />
          Alle
        </Button>
      </div>

      <input
        type="range"
        min={min}
        max={Math.max(min, cap)}
        value={current}
        onChange={(e) => {
          setPlaying(false)
          set(Number(e.target.value))
        }}
        className="h-2 min-w-40 flex-1 accent-primary"
        aria-label="Replay-Position"
      />

      <div className="flex items-center gap-0.5" role="group" aria-label="Geschwindigkeit">
        {SPEEDS.map((s, i) => (
          <Button
            key={s.label}
            size="sm"
            variant={i === speed ? 'secondary' : 'ghost'}
            className="h-7 px-1.5 font-mono text-[10px]"
            title={`Ein Schritt alle ${s.ms} ms`}
            onClick={() => setSpeed(i)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <div className="w-full font-mono text-[10px] text-muted-foreground sm:w-auto sm:text-right">
        {gesperrt && lockedHint ? (
          <span className="inline-flex items-center gap-1 text-warning">
            <Lock className="size-3" />
            {lockedHint}
          </span>
        ) : (
          <>
            {current} / {total} Kerzen sichtbar
            {future > 0 ? ` · ${future} verborgen` : ' · vollständig'}
          </>
        )}
      </div>
    </div>
  )
}
