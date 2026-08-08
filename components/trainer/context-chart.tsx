'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { PriceChart } from '@/components/chart/price-chart'
import type { Drawing } from '@/app/actions/drawings'
import type { Candle } from '@/lib/market-data/types'
import { kontextEbene, type ChartTimeframe } from '@/lib/chart-timeframes'

/**
 * Der übergeordnete Kontext neben der Arbeitsebene.
 *
 * WARUM DAS KEIN KOMFORT IST
 * Der Trainer misst, ob eine These VOR dem Ergebnis stand. Eine These über eine
 * Wellenzählung setzt aber voraus, dass die übergeordnete Struktur überhaupt
 * lesbar ist. Läuft eine Übung auf Stundenkerzen, endet der Vorlauf nach elf
 * Handelstagen — der Anfang der Welle liegt links vom Bild, und zwar
 * unerreichbar: Der Replay zeigt die ersten gelieferten Kerzen der Basisebene,
 * links davon gibt es nichts, auch nicht durch Rauszoomen. Wer den Zyklus nicht
 * sieht, kann Invalidation und Ziel nicht begründen, sondern nur behaupten — und
 * die Trainingsstatistik behauptete trotzdem eine Quote. Genau die Sorte stiller
 * Falschaussage, gegen die diese App gebaut ist.
 *
 * WARUM ES KEINE ZUKUNFT VERRÄT
 * Innen steht derselbe `PriceChart` mit derselben `trainingSessionId` und
 * derselben Basis-Zeitebene wie der Arbeitschart. Damit greift der bestehende
 * Zuschnitt aus `lib/replay-timeframes.ts` unverändert: Fertige Kerzen kommen
 * unverändert, die angebrochene wird aus der Basis nachgerechnet. Der Stand
 * kommt über `replayFollow` vom Arbeitschart — der Kontext-Chart hält keinen
 * eigenen. Kein zweiter Ladeweg, keine zweite Wahrheit.
 *
 * WARUM HIER GEZEICHNET WERDEN DARF — DAS IST DER KERN
 * Zeichnungen liegen in `{time, price}` (`training_annotation`, ohne
 * Zeitebenen-Spalte) und gelten deshalb ebenenübergreifend. Ein Fib, hier über
 * die ganze Welle gezogen, steht danach im Arbeitschart — auch wenn sein Anker
 * vor dessen erster Kerze liegt (`lib/chart-coords.ts` rechnet dorthin ins
 * Negative fort, statt die Zeichnung fallen zu lassen). So wird der Anker
 * erreichbar, ohne dass die Arbeitsebene weiter zurückreichen müsste.
 */

/** Unter so vielen Kerzen ist eine Ebene kein Kontext, sondern ein Ausschnitt. */
const DUENN_AB = 60

const SPEICHER_SCHLUESSEL = 'trainer.kontextChart.offen'

/** Auf-/Zugeklappt aus dem Browser lesen — reiner Ansichtszustand, keine Messgröße. */
function gemerkterZustand(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SPEICHER_SCHLUESSEL) === '1'
  } catch {
    // Privater Modus oder gesperrter Speicher: zu ist der harmlosere Rückfall.
    return false
  }
}

export function ContextChart({
  session,
  annotations,
  onDrawingsChange,
  replayStart,
  replayMaxVisible,
  verdeckt,
}: {
  session: { id: number; symbol: string | null; market: string | null; timeframe: string }
  annotations: Drawing[]
  /** Zeichnungen zurück an den Arbeitsplatz — er hält sie für beide Charts. */
  onDrawingsChange: (drawings: Drawing[]) => void
  /**
   * Der Stand des Arbeitscharts, in Kerzen der Basis-Ebene. Er FÜHRT diesen
   * Chart — deshalb steht er hier als Pflichtangabe und nicht als Vorschlag.
   */
  replayStart: number
  replayMaxVisible?: number
  verdeckt: boolean
}) {
  // Erst nach dem Einhängen aus dem Speicher lesen: Der Server kennt
  // `localStorage` nicht, und ein Unterschied zwischen beiden Durchläufen wäre
  // ein Hydrations-Fehler.
  const [offen, setOffen] = useState(false)
  useEffect(() => {
    setOffen(gemerkterZustand())
  }, [])

  const umschalten = useCallback(() => {
    setOffen((v) => {
      const neu = !v
      try {
        window.localStorage.setItem(SPEICHER_SCHLUESSEL, neu ? '1' : '0')
      } catch {
        /* Nicht merken zu können ist kein Grund, nicht aufzuklappen. */
      }
      return neu
    })
  }, [])

  const basis = session.timeframe as ChartTimeframe
  const ebene = useMemo(() => kontextEbene(session.timeframe), [session.timeframe])

  // Wie weit die angesehene Ebene wirklich zurückreicht. Wird gemeldet statt
  // geschätzt — eine kurze Reihe darf nicht aussehen wie eine vollständige.
  const [gesehen, setGesehen] = useState<Candle[] | null>(null)
  const merkeAnsicht = useCallback((c: Candle[]) => setGesehen(c), [])

  const reichweite = useMemo(() => {
    if (!gesehen || gesehen.length === 0) return null
    const tage = Math.round((gesehen[gesehen.length - 1].time - gesehen[0].time) / 86400)
    return { anzahl: gesehen.length, tage }
  }, [gesehen])

  const duenn = reichweite != null && reichweite.anzahl < DUENN_AB

  return (
    <div className="panel-sunken p-3">
      <button
        type="button"
        onClick={umschalten}
        aria-expanded={offen}
        className="flex w-full items-center gap-2 text-left"
      >
        <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="section-label">Übergeordneter Kontext</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {ebene}
          {ebene === basis && ' · schon die Arbeitsebene'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {duenn && (
            <span className="font-mono text-[10px] text-warning">wenig Historie</span>
          )}
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${
              offen ? 'rotate-180' : ''
            }`}
            aria-hidden
          />
        </span>
      </button>

      {offen && (
        <div className="mt-3 space-y-2">
          <PriceChart
            symbol={session.symbol ?? ''}
            market={session.market ?? 'aktien'}
            stockId={undefined}
            trainingSessionId={session.id}
            initialDrawings={annotations}
            onDrawingsChange={onDrawingsChange}
            // Die abweichende Ebene ist der ganze Zweck; frei umschaltbar bleibt
            // sie trotzdem — welcher Zyklus zählt, entscheidet der Übende.
            defaultTimeframe={ebene}
            replayMode
            replayBasisTimeframe={basis}
            replayFollow
            replayStart={replayStart}
            replayMaxVisible={replayMaxVisible}
            hideIdentity={verdeckt}
            onViewCandlesLoaded={merkeAnsicht}
            heightClass="h-[300px] sm:h-[380px] xl:h-[min(42vh,460px)]"
          />

          <p className="note">
            {reichweite == null
              ? 'Kontext wird geladen ...'
              : duenn
                ? `Nur ${reichweite.anzahl} Kerzen (${reichweite.tage} Tage) — für einen übergeordneten Zyklus zu wenig. Für dieses Instrument liegt noch nicht mehr Historie vor; behandle den Kontext hier als unbekannt, nicht als „kein Trend".`
                : `${reichweite.anzahl} Kerzen, ${reichweite.tage} Tage zurück. Steht auf demselben Moment wie der Arbeitschart; die angebrochene Kerze ist mitgerechnet, nicht vorweggenommen.`}
          </p>
          <p className="note">
            Zeichnungen gelten ebenenübergreifend: Was du hier über die ganze Welle ziehst —
            etwa ein Fib —, steht danach auch im Arbeitschart, selbst wenn sein Anker vor
            dessen erster Kerze liegt.
          </p>
        </div>
      )}
    </div>
  )
}
