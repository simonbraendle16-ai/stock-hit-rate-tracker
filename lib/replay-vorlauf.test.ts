import { describe, expect, it } from 'vitest'
import {
  VORLAUF_SCHWELLE,
  brauchtVorlauf,
  vorlaufGewachsen,
  vorlaufGrenze,
  vorlaufVoranstellen,
} from './replay-vorlauf'
import { kerzenBisZeitpunkt, replayEnde } from './replay-timeframes'
import type { Candle } from './market-data/types'

const H = 3600
const k = (time: number, close = 100): Candle => ({
  time,
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 10,
})

/** Zwanzig Stundenkerzen ab einem festen Nullpunkt. */
const reihe = Array.from({ length: 20 }, (_, i) => k(1_700_000_000 + i * H, 100 + i))
/** Zehn ältere Stundenkerzen davor. */
const aeltere = Array.from({ length: 10 }, (_, i) => k(1_700_000_000 - (10 - i) * H, 50 + i))

describe('brauchtVorlauf', () => {
  it('lädt nach, wenn der linke Rand nah genug ist', () => {
    expect(brauchtVorlauf(VORLAUF_SCHWELLE, false, false)).toBe(true)
    expect(brauchtVorlauf(0, false, false)).toBe(true)
    expect(brauchtVorlauf(-40, false, false)).toBe(true)
  })

  it('lässt es, solange der Rand weit weg ist', () => {
    expect(brauchtVorlauf(VORLAUF_SCHWELLE + 1, false, false)).toBe(false)
    expect(brauchtVorlauf(300, false, false)).toBe(false)
  })

  it('fragt nicht doppelt und nicht am Anfang der Historie', () => {
    expect(brauchtVorlauf(0, true, false)).toBe(false)
    expect(brauchtVorlauf(0, false, true)).toBe(false)
  })

  it('hält bei fehlender Messung still, statt zu raten', () => {
    expect(brauchtVorlauf(null, false, false)).toBe(false)
    expect(brauchtVorlauf(undefined, false, false)).toBe(false)
    expect(brauchtVorlauf(Number.NaN, false, false)).toBe(false)
  })
})

describe('vorlaufGrenze', () => {
  it('ist die erste vorhandene Kerze', () => {
    expect(vorlaufGrenze(reihe)).toBe(reihe[0].time)
  })

  it('ist ohne Kerzen unbekannt statt 0', () => {
    expect(vorlaufGrenze([])).toBeNull()
  })
})

describe('vorlaufVoranstellen', () => {
  it('setzt ältere Kerzen davor und lässt die Reihenfolge steigen', () => {
    const neu = vorlaufVoranstellen(reihe, aeltere)
    expect(neu).toHaveLength(30)
    expect(neu[0].time).toBe(aeltere[0].time)
    for (let i = 1; i < neu.length; i++) {
      expect(neu[i].time).toBeGreaterThan(neu[i - 1].time)
    }
  })

  it('nimmt eine überlappende Kerze nicht doppelt — der Bestand gewinnt', () => {
    const mitUeberlappung = [...aeltere, { ...reihe[0], close: 999 }]
    const neu = vorlaufVoranstellen(reihe, mitUeberlappung)
    expect(neu).toHaveLength(30)
    expect(neu.find((c) => c.time === reihe[0].time)?.close).toBe(reihe[0].close)
  })

  it('gibt den Bestand unverändert zurück, wenn nichts Neues kommt', () => {
    expect(vorlaufVoranstellen(reihe, [])).toBe(reihe)
    expect(vorlaufVoranstellen(reihe, [reihe[3]])).toBe(reihe)
  })
})

describe('vorlaufGewachsen', () => {
  it('zählt nur echten Zuwachs', () => {
    expect(vorlaufGewachsen(reihe, vorlaufVoranstellen(reihe, aeltere))).toBe(10)
    expect(vorlaufGewachsen(reihe, reihe)).toBe(0)
  })
})

/**
 * DIE ZUSAGE DES GANZEN BAUSTEINS.
 *
 * Der Replay zählt Kerzen ab Index 0. Wenn links Kerzen dazukommen, darf der
 * erreichte Moment sich NICHT verschieben — sonst springt eine laufende Übung
 * an eine andere Stelle, und zwar unbemerkt. Hier steht als Test, warum das
 * nicht passieren kann: Die zählende Reihe (die Basis) wird nicht angefasst;
 * der Vorlauf geht nur an die ANGESEHENE Reihe.
 */
describe('vorlaufIstFolgenlos — der Replay-Stand verschiebt sich nicht', () => {
  const stand = 12

  it('lässt den erreichten Moment unverändert', () => {
    const vorher = replayEnde(reihe, stand, H)
    // Der Vorlauf geht an die Anzeige, nicht an die Basis.
    const angezeigt = vorlaufVoranstellen(reihe, aeltere)
    const nachher = replayEnde(reihe, stand, H)
    expect(nachher).toBe(vorher)
    expect(angezeigt).toHaveLength(30)
  })

  it('zeigt links mehr, schneidet rechts aber an derselben Stelle ab', () => {
    const ende = replayEnde(reihe, stand, H)!
    const ohne = kerzenBisZeitpunkt(reihe, reihe, ende, H, H)
    const mit = kerzenBisZeitpunkt(vorlaufVoranstellen(reihe, aeltere), reihe, ende, H, H)

    // Rechts identisch — keine einzige Kerze mehr aus der Zukunft.
    expect(mit[mit.length - 1].time).toBe(ohne[ohne.length - 1].time)
    // Links genau die zehn nachgeladenen Kerzen mehr.
    expect(mit).toHaveLength(ohne.length + aeltere.length)
    expect(mit[0].time).toBe(aeltere[0].time)
  })

  it('gilt auch, wenn der Stand am letzten freigegebenen Punkt steht', () => {
    for (const s of [1, 5, 12, 19, 20]) {
      const ende = replayEnde(reihe, s, H)
      const angezeigt = vorlaufVoranstellen(reihe, aeltere)
      expect(replayEnde(reihe, s, H)).toBe(ende)
      const mit = kerzenBisZeitpunkt(angezeigt, reihe, ende!, H, H)
      const ohne = kerzenBisZeitpunkt(reihe, reihe, ende!, H, H)
      expect(mit[mit.length - 1].time).toBe(ohne[ohne.length - 1].time)
    }
  })
})
