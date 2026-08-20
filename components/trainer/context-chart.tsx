'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { PriceChart } from '@/components/chart/price-chart'
import type { Drawing } from '@/app/actions/drawings'
import type { Candle } from '@/lib/market-data/types'
import {
  MAX_KONTEXT_EBENEN,
  ebenenUeber,
  kontextEbenen,
  type ChartTimeframe,
} from '@/lib/chart-timeframes'
import { setContextTimeframes } from '@/app/actions/training'
import { toast } from 'sonner'

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
 *
 * WARUM BIS ZU ZWEI EBENEN (Teil 4)
 * Eine Ebene beantwortet „in welchem übergeordneten Zyklus stehen wir?". Sie
 * beantwortet nicht, in welchem Abschnitt DIESER Zyklus selbst steht — und
 * genau daran hängt, ob eine Zählung begründet ist oder behauptet. Deshalb sind
 * es null, eine oder zwei Ebenen, jede frei wählbar. Null ist ausdrücklich
 * erlaubt: Wer ohne Kontext übt, soll das tun dürfen, aber sichtbar.
 *
 * Die Sicherheit gegen Zukunftswissen ändert sich dadurch NICHT. Beide Charts
 * bekommen dieselbe `replayBasisTimeframe` und denselben Stand wie der
 * Arbeitschart; `kerzenBisZeitpunkt` schneidet jede Ebene einzeln am selben
 * Moment zu. Die Regel hängt an der Basis, nicht an der Anzahl der Ansichten.
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
  session: {
    id: number
    symbol: string | null
    market: string | null
    timeframe: string
    /** Gesäubert aus `normalizeKontextEbenen` — leer heißt „bewusst keine". */
    contextTimeframes: string[]
    /** Nach dem Festschreiben ist die Ebenenwahl Teil des Protokolls. */
    status: string
  }
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
  const waehlbar = useMemo(() => ebenenUeber(session.timeframe), [session.timeframe])
  const festgeschrieben = session.status !== 'offen'

  // Die Ebenen der Übung. Lokal gespiegelt, damit die Auswahl sofort wirkt —
  // geschrieben wird sie serverseitig, und der Server bleibt die Wahrheit.
  const [ebenen, setEbenen] = useState<ChartTimeframe[]>(
    () => session.contextTimeframes as ChartTimeframe[],
  )
  const [speichert, setSpeichert] = useState(false)

  const uebernehmen = useCallback(
    async (neu: ChartTimeframe[]) => {
      const vorher = ebenen
      setEbenen(neu)
      setSpeichert(true)
      try {
        const antwort = await setContextTimeframes(session.id, neu)
        if ('error' in antwort) {
          // Zurückrollen: Eine Auswahl, die der Server abgelehnt hat, darf nicht
          // stehen bleiben — sonst zeigte der Chart etwas anderes als die Übung.
          setEbenen(vorher)
          toast.error(antwort.error)
        } else {
          setEbenen(antwort.ebenen as ChartTimeframe[])
        }
      } catch (err) {
        setEbenen(vorher)
        toast.error(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.')
      } finally {
        setSpeichert(false)
      }
    },
    [ebenen, session.id],
  )

  /** Anzahl umstellen: Vorbelegung per Stufenabstand, Vorhandenes bleibt stehen. */
  const setzeAnzahl = useCallback(
    (n: number) => {
      if (n === ebenen.length) return
      if (n < ebenen.length) return void uebernehmen(ebenen.slice(0, n))
      const vorschlag = kontextEbenen(session.timeframe, n)
      const neu = [...ebenen]
      for (const v of vorschlag) {
        if (neu.length >= n) break
        if (!neu.includes(v)) neu.push(v)
      }
      // Reicht der Vorschlag nicht (oberes Ende), mit der nächstbesten freien
      // Ebene auffüllen statt stillschweigend weniger anzuzeigen.
      for (const v of waehlbar) {
        if (neu.length >= n) break
        if (!neu.includes(v)) neu.push(v)
      }
      void uebernehmen(neu.slice(0, n))
    },
    [ebenen, session.timeframe, uebernehmen, waehlbar],
  )

  /** Eine einzelne Ebene austauschen. Doppelt gewählte Ebenen lässt der Server fallen. */
  const setzeEbene = useCallback(
    (index: number, wert: ChartTimeframe) => {
      const neu = [...ebenen]
      neu[index] = wert
      void uebernehmen(neu)
    },
    [ebenen, uebernehmen],
  )

  // Wie weit die angesehenen Ebenen wirklich zurückreichen. Wird je Ebene
  // gemeldet statt geschätzt — eine kurze Reihe darf nicht aussehen wie eine
  // vollständige, und das gilt für jede Ansicht einzeln.
  const [gesehen, setGesehen] = useState<Record<string, Candle[]>>({})

  /**
   * Je Ebene EINE stabile Rückmeldefunktion.
   *
   * Nicht `(tf) => (c) => ...` bei jedem Render neu bauen: `PriceChart` hat
   * `onViewCandlesLoaded` in der Abhängigkeitsliste seines Melde-Effekts. Eine
   * bei jedem Render neue Funktion lässt den Effekt erneut feuern, das setzt
   * hier Zustand, das rendert neu — und die Seite dreht sich fest, ohne dass
   * ein Fehler im Protokoll steht. Genau das ist beim Bauen passiert.
   *
   * Der Vergleich in `setGesehen` ist die zweite Hälfte derselben Absicherung:
   * Dieselbe Kerzenreihe erzeugt keinen neuen Zustand.
   */
  const merkeAnsicht = useMemo(() => {
    const map: Record<string, (c: Candle[]) => void> = {}
    for (const tf of ebenen) {
      map[tf] = (c: Candle[]) =>
        setGesehen((p) => (p[tf] === c ? p : { ...p, [tf]: c }))
    }
    return map
  }, [ebenen])

  const reichweiteVon = useCallback(
    (tf: string) => {
      const c = gesehen[tf]
      if (!c || c.length === 0) return null
      const tage = Math.round((c[c.length - 1].time - c[0].time) / 86400)
      return { anzahl: c.length, tage, duenn: c.length < DUENN_AB }
    },
    [gesehen],
  )

  const irgendwoDuenn = ebenen.some((tf) => reichweiteVon(tf)?.duenn === true)

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
          {ebenen.length === 0 ? 'keine Ebene' : ebenen.join(' · ')}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {irgendwoDuenn && (
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
        <div className="mt-3 space-y-3">
          {/* Auswahl: wie viele Ebenen, und welche. Beides frei — welcher Zyklus
              zählt, entscheidet der Übende, nicht eine Formel. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="section-label">Ebenen</span>
              <div className="flex gap-1">
                {[0, 1, 2].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={festgeschrieben || speichert || n > waehlbar.length}
                    onClick={() => setzeAnzahl(n)}
                    aria-pressed={ebenen.length === n}
                    className={`h-9 w-9 rounded-lg border font-mono text-xs transition-colors ${
                      ebenen.length === n
                        ? 'border-primary/50 bg-primary/15 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    } disabled:opacity-40`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {ebenen.map((tf, i) => (
              <div key={`wahl-${i}`} className="flex flex-col gap-1">
                <span className="section-label">Kontext {i + 1}</span>
                <select
                  value={tf}
                  disabled={festgeschrieben || speichert}
                  onChange={(e) => setzeEbene(i, e.target.value as ChartTimeframe)}
                  className="input-ocean h-9 rounded-lg px-2 font-mono text-xs disabled:opacity-40"
                >
                  {waehlbar.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {festgeschrieben && (
            <p className="note">
              Die Ebenen stehen fest, seit die These festgeschrieben ist — sie sind die
              Grundlage, auf der sie entstanden ist.
            </p>
          )}

          {waehlbar.length === 0 && (
            <p className="note">
              Über „{basis}" gibt es hier keine Ebene mehr. Das ist kein Fehler, sondern das
              obere Ende — behandle den übergeordneten Zyklus als unbekannt.
            </p>
          )}

          {ebenen.length === 0 && waehlbar.length > 0 && (
            <p className="note">
              Ohne übergeordnete Ebene. Zulässig — aber eine Wellenzählung ohne Blick auf den
              Zyklus darüber ist eine Behauptung, keine Ableitung.
            </p>
          )}

          {ebenen.map((tf, i) => {
            const r = reichweiteVon(tf)
            return (
              <div key={tf} className="chart-frame space-y-2">
                <div className="flex items-center gap-2">
                  <span className="section-label">Kontext {i + 1}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{tf}</span>
                  {r?.duenn && (
                    <span className="ml-auto font-mono text-[10px] text-warning">
                      wenig Historie
                    </span>
                  )}
                </div>

                <PriceChart
                  symbol={session.symbol ?? ''}
                  market={session.market ?? 'aktien'}
                  stockId={undefined}
                  trainingSessionId={session.id}
                  initialDrawings={annotations}
                  onDrawingsChange={onDrawingsChange}
                  // Die abweichende Ebene ist der ganze Zweck; frei umschaltbar
                  // bleibt sie trotzdem — welcher Zyklus zählt, entscheidet der
                  // Übende.
                  defaultTimeframe={tf}
                  replayMode
                  // Dieselbe Basis wie der Arbeitschart: Daran hängt der
                  // Zuschnitt, und nur dadurch stehen alle Ansichten auf
                  // demselben Moment.
                  replayBasisTimeframe={basis}
                  replayFollow
                  replayStart={replayStart}
                  replayMaxVisible={replayMaxVisible}
                  hideIdentity={verdeckt}
                  onViewCandlesLoaded={merkeAnsicht[tf]}
                  heightClass={
                    ebenen.length > 1
                      ? 'h-[240px] sm:h-[300px] xl:h-[min(32vh,360px)]'
                      : 'h-[300px] sm:h-[380px] xl:h-[min(42vh,460px)]'
                  }
                />

                <p className="note">
                  {r == null
                    ? 'Kontext wird geladen ...'
                    : r.duenn
                      ? `Nur ${r.anzahl} Kerzen (${r.tage} Tage) — für einen übergeordneten Zyklus zu wenig. Für dieses Instrument liegt noch nicht mehr Historie vor; behandle den Kontext hier als unbekannt, nicht als „kein Trend".`
                      : `${r.anzahl} Kerzen, ${r.tage} Tage zurück. Steht auf demselben Moment wie der Arbeitschart; die angebrochene Kerze ist mitgerechnet, nicht vorweggenommen.`}
                </p>
              </div>
            )
          })}

          {ebenen.length > 0 && (
            <p className="note">
              Zeichnungen gelten ebenenübergreifend: Was du hier über die ganze Welle ziehst —
              etwa ein Fib —, steht danach auch im Arbeitschart, selbst wenn sein Anker vor
              dessen erster Kerze liegt.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
