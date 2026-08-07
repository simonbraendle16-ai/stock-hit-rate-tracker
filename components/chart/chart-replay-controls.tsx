'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { playAktion, replaySkala } from '@/lib/replay-start'

/** Abspielgeschwindigkeiten in Millisekunden je Kerze. */
const SPEEDS = [
  { label: '0,5×', ms: 1300 },
  { label: '1×', ms: 650 },
  { label: '2×', ms: 300 },
  { label: '4×', ms: 130 },
  // Zusehen ist nicht die Übung. Wer 200 Kerzen überbrücken will, soll dafür
  // keine fünf Minuten brauchen.
  { label: '10×', ms: 50 },
]

export function ChartReplayControls({
  total,
  visible,
  onChange,
  start,
  maxVisible,
  lockedHint,
  released,
  onRelease,
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
  /** Erklärt, warum die Grenze steht. */
  lockedHint?: string
  /**
   * Ist der Durchlauf schon losgelassen?
   *
   * Ohne Angabe gilt „ja" — jeder Chart außerhalb des Trainers hat nichts
   * loszulassen, und dort soll Play sich verhalten wie bisher.
   */
  released?: boolean
  /**
   * Den Durchlauf loslassen. Wird gerufen, wenn Play am Startpunkt gedrückt
   * wird, bevor irgendetwas entschieden wurde — die Übung wertet das als
   * „Nein — weiterlaufen" und hält es als Enthaltung fest.
   */
  onRelease?: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  // Skala und Sperre kommen aus derselben reinen Quelle (`lib/replay-start.ts`).
  // Bis hierher endete der Regler an der SPERRE statt an der Reihe: Beim Öffnen
  // einer Übung stand der Griff damit am rechten Anschlag und Play war
  // abgeschaltet — es sah aus, als begänne die Übung an ihrem Ende.
  const skala = replaySkala(total, visible, maxVisible)
  const { min, wert: current, grenze: cap, gesperrt } = skala
  const canReplay = total > min
  const losgelassen = released ?? true
  const aktion = playAktion(current, cap, losgelassen)
  const startAt = Math.min(cap, Math.max(min, start ?? Math.round(total * 0.62)))
  const future = Math.max(0, total - current)
  const atCap = current >= cap
  // Play ist nur noch tot, wenn es wirklich nichts zu tun gibt: am Haltepunkt
  // eines laufenden Durchlaufs (dort gehört die Antwort ins Feld daneben) oder
  // am Ende der Reihe.
  const playTot = aktion === 'blockiert'

  useEffect(() => {
    if (!playing || !canReplay) return
    if (current >= cap) {
      // Am Anschlag: Ist der Durchlauf noch nie losgelassen worden, lässt ihn
      // dieser Druck los. Die Grenze rückt daraufhin nach, dieser Effekt läuft
      // erneut und nimmt den Takt auf — deshalb bleibt `playing` hier stehen.
      if (aktion === 'loslassen' && onRelease) {
        onRelease()
        return
      }
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => onChange(Math.min(cap, current + 1)), SPEEDS[speed].ms)
    return () => clearTimeout(timer)
  }, [playing, canReplay, current, cap, onChange, speed, aktion, onRelease])

  /**
   * Einen Schritt vorwärts — und am Anschlag stattdessen loslassen.
   *
   * Dieselbe Entscheidung wie bei Play, deshalb dieselbe Funktion: Ein
   * Vorwärtsknopf, der am Startpunkt nichts tut, während Play dort den
   * Durchlauf startet, wären zwei Meinungen darüber, was „weiter" heißt.
   */
  const vor = useCallback(
    (n: number) => {
      if (current >= cap) {
        if (aktion === 'loslassen' && onRelease) onRelease()
        return
      }
      onChange(Math.min(cap, current + n))
    },
    [current, cap, aktion, onRelease, onChange],
  )

  /**
   * Tastatur: Leertaste spielt und hält an, die Pfeiltasten gehen Kerze für
   * Kerze.
   *
   * Beim Üben liegt der Blick auf dem Chart, nicht auf der Leiste — jeder Griff
   * zur Maus unterbricht genau das Lesen, das geübt werden soll. Mit Umschalt
   * geht es in Zehnerschritten.
   *
   * In einem Eingabefeld gilt die Tastatur natürlich dem Feld; sonst würde die
   * Leertaste im Notizfeld den Replay starten.
   */
  useEffect(() => {
    if (!canReplay) return
    const onKey = (e: KeyboardEvent) => {
      const ziel = e.target as HTMLElement | null
      const tag = ziel?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ziel?.isContentEditable) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const schritt = e.shiftKey ? 10 : 1
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        vor(schritt)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPlaying(false)
        onChange(Math.max(min, current - schritt))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canReplay, current, min, onChange, vor])

  if (!canReplay) {
    return (
      <div className="panel-sunken mt-3 px-3 py-2">
        <p className="note">
          Replay braucht mehr Kerzen. Wähle ein anderes Symbol oder eine größere Zeitebene.
        </p>
      </div>
    )
  }

  const set = (next: number) => onChange(Math.min(cap, Math.max(min, next)))

  return (
    <div className="panel-sunken mt-3 flex flex-wrap items-center gap-2 px-3 py-2">
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
          disabled={playTot}
          title={
            playing
              ? 'Pause'
              : aktion === 'loslassen'
                ? 'Durchlauf starten — läuft ab dem Startpunkt vorwärts'
                : playTot
                  ? 'Haltepunkt — erst die Frage daneben beantworten'
                  : 'Abspielen'
          }
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={playTot}
          title="Nächste Kerze"
          onClick={() => vor(1)}
        >
          <StepForward className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={playTot}
          title="10 Kerzen vor"
          onClick={() => vor(10)}
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

      {/* Der Regler spannt über die GANZE Reihe — auch über den gesperrten Teil.
          Vorher endete er an der Sperre, und damit stand der Griff beim Öffnen
          einer Übung am rechten Anschlag: Es sah aus, als sei die Übung schon
          durchgelaufen. Verborgen bleibt die Zukunft weiterhin (der Wert wird
          auf die Freigabe geklemmt) — sie wird nur nicht mehr weggekürzt,
          sondern als gesperrt gezeigt. */}
      <div className="relative flex min-w-40 flex-1 items-center">
        <input
          type="range"
          min={min}
          max={skala.max}
          value={current}
          onChange={(e) => {
            setPlaying(false)
            set(Number(e.target.value))
          }}
          className="h-2 w-full accent-primary"
          aria-label="Replay-Position"
          aria-valuetext={`${current} von ${total} Kerzen${gesperrt ? `, freigegeben bis ${cap}` : ''}`}
        />
        {gesperrt && skala.sperrAnteil > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-1/2 h-2 -translate-y-1/2 rounded-r-sm"
            style={{
              width: `${skala.sperrAnteil * 100}%`,
              // Kräftig genug, um als „hier geht es nicht weiter" gelesen zu
              // werden. Mit 20 % Deckkraft war die Schraffur auf dem dunklen
              // Panel praktisch unsichtbar — eine Sperre, die man nicht sieht,
              // erklärt den stehenden Regler nicht.
              background:
                'repeating-linear-gradient(135deg, rgba(224,180,85,0.55) 0 3px, rgba(224,180,85,0.10) 3px 7px)',
            }}
          />
        )}
      </div>

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

      {/* Die Zählung steht ab hier IMMER da. Vorher ersetzte der Sperrhinweis
          sie — und damit war in genau der Lage, in der man wissen will, wo man
          steht, keine Zahl zu sehen. Die Sperre kommt daneben, nicht anstelle. */}
      <div className="w-full font-mono text-[10px] text-muted-foreground sm:w-auto sm:text-right">
        {current} / {total} Kerzen sichtbar
        {future > 0 ? ` · ${future} verborgen` : ' · vollständig'}
        {gesperrt && (
          <span
            className={`ml-2 inline-flex items-center gap-1 ${
              playTot ? 'text-warning' : 'opacity-70'
            }`}
          >
            <Lock className="size-3" />
            {aktion === 'loslassen'
              ? 'Play startet den Durchlauf'
              : (lockedHint ?? `freigegeben bis ${cap}`)}
          </span>
        )}
        {/* Eine Tastenbelegung, die niemand kennt, gibt es nicht. */}
        <span className="ml-2 hidden opacity-60 lg:inline">
          Leertaste = abspielen · ← → = Kerze · Umschalt = 10
        </span>
      </div>
    </div>
  )
}
