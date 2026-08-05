/**
 * Mehrere Zeitebenen in EINEM Replay — ohne die Zukunft zu verraten.
 *
 * WARUM DAS DER KERN DES TRAININGS IST
 * Wer einen Chart nur auf einer Ebene sieht, hat keine Grundlage: Aus fünfzig
 * 15-Minuten-Kerzen lässt sich keine Struktur ableiten, aus der eine These
 * folgen könnte. Gehandelt wird von oben nach unten — erst der große Kontext
 * (Wo stehen wir? Trend oder Spanne?), dann die kleine Ebene für den Einstieg.
 * Ohne diesen Weg übt man raten statt lesen.
 *
 * WARUM ES NICHT REICHT, EINFACH TAGESKERZEN ZU LADEN
 * Der Replay steht an einem bestimmten Moment. Die Tageskerze, in der dieser
 * Moment liegt, ist zu diesem Zeitpunkt noch **nicht fertig** — ihr Hoch und
 * Tief enthalten, was erst noch passiert. Sie unverändert zu zeigen, wäre ein
 * Blick in die Zukunft, und zwar der schlimmste: einer, den man nicht bemerkt.
 * Die Übung würde still bedeutungslos.
 *
 * DIE REGEL HIER
 *  - Kerzen, die **vollständig** vor dem Replay-Moment liegen, kommen unverändert.
 *  - Die **angebrochene** Kerze wird aus den Kerzen der Basis-Zeitebene neu
 *    gerechnet, und zwar nur aus denen, die selbst schon fertig sind.
 *  - Reicht die Basis dafür nicht, fällt die angebrochene Kerze **weg**. Lieber
 *    eine Kerze zu wenig als eine, die mehr weiß als der Übende.
 *
 * Rein und getestet — hier entscheidet sich, ob eine verdeckte Übung etwas
 * misst oder nicht.
 */

import type { Candle } from './market-data/types'
import type { Interval } from './market-data/types'

/** Länge eines Intervalls in Sekunden. */
export const INTERVAL_SEKUNDEN: Record<Interval, number> = {
  '15min': 15 * 60,
  '30min': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1day': 24 * 60 * 60,
  // Näherungen, und das ist in Ordnung: Gebraucht wird die Länge nur, um zu
  // entscheiden, ob eine Kerze noch läuft. Die tatsächlichen Grenzen kommen
  // aus den Zeitstempeln des Anbieters, nicht aus dieser Tabelle.
  '1week': 7 * 24 * 60 * 60,
  '1month': 30 * 24 * 60 * 60,
}

export function intervalSekunden(i: Interval): number {
  return INTERVAL_SEKUNDEN[i] ?? 24 * 60 * 60
}

/**
 * Das exklusive Ende des sichtbaren Zeitraums.
 *
 * Der Replay zeigt `sichtbar` fertige Kerzen der Basis-Ebene. Der erreichte
 * Moment ist deshalb das ENDE der letzten davon, nicht ihr Anfang — sonst läge
 * der Schnitt um eine Kerze zu früh und die Ebenen liefen auseinander.
 */
export function replayEnde(
  basis: Candle[],
  sichtbar: number,
  basisSekunden: number,
): number | null {
  const i = Math.min(basis.length, Math.max(0, sichtbar)) - 1
  if (i < 0) return null
  // Die echte Grenze zur Folgekerze schlägt die Tabelle: Bei Tages- und
  // Wochenkerzen sind Wochenenden und Feiertage sonst nicht abgebildet.
  const naechste = basis[i + 1]
  return naechste ? naechste.time : basis[i].time + basisSekunden
}

/**
 * Kerzen der Ziel-Zeitebene, abgeschnitten am Replay-Moment.
 *
 * `basis` sind die Kerzen der Zeitebene, in der der Replay läuft — aus ihnen
 * wird die angebrochene Zielkerze zusammengesetzt.
 */
export function kerzenBisZeitpunkt(
  ziel: Candle[],
  basis: Candle[],
  endeZeit: number,
  zielSekunden: number,
  basisSekunden: number,
): Candle[] {
  if (ziel.length === 0) return []

  const fertig: Candle[] = []
  let offen: Candle | null = null

  for (let i = 0; i < ziel.length; i++) {
    const c = ziel[i]
    if (c.time >= endeZeit) break
    // Die echte Grenze ist der Beginn der nächsten Kerze; nur wo es keine gibt,
    // hilft die Intervall-Länge weiter.
    const naechste = ziel[i + 1]
    const ende = naechste ? naechste.time : c.time + zielSekunden
    if (ende <= endeZeit) fertig.push(c)
    else offen = c
  }

  if (!offen) return fertig

  // Angebrochene Kerze aus den FERTIGEN Basiskerzen im selben Fenster bauen.
  const teile = basis.filter(
    (b) => b.time >= offen!.time && b.time + basisSekunden <= endeZeit,
  )
  if (teile.length === 0) return fertig

  let high = teile[0].high
  let low = teile[0].low
  let volumen = 0
  for (const t of teile) {
    if (t.high > high) high = t.high
    if (t.low < low) low = t.low
    if (Number.isFinite(t.volume)) volumen += t.volume
  }

  fertig.push({
    time: offen.time,
    open: teile[0].open,
    high,
    low,
    close: teile[teile.length - 1].close,
    volume: volumen,
  })
  return fertig
}
