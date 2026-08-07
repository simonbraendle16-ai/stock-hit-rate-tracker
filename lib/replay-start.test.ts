import { describe, expect, it } from 'vitest'
import {
  MAX_START_FENSTER,
  REGLER_MIN,
  ansichtNeuSetzen,
  playAktion,
  replaySkala,
  replayStand,
  startFenster,
  type AnsichtStand,
} from './replay-start'
import { DEFAULT_START_FRACTION, MIN_VISIBLE_CANDLES } from './training'

describe('replayStand', () => {
  it('nimmt den gewünschten Startpunkt, wenn er passt', () => {
    expect(replayStand(1000, 250, null)).toBe(250)
    expect(replayStand(1000, 800, null)).toBe(800)
  })

  it('klemmt an der Obergrenze der Übung', () => {
    // Genau der Fehler aus der Praxis: Der Chart hatte sich 62 % gesetzt (620),
    // die Übung gibt aber erst 250 frei. Ohne diese Klemmung lag die Zukunft
    // offen und der Regler stand auf „durchgelaufen".
    expect(replayStand(1000, 620, 250)).toBe(250)
    expect(replayStand(1000, 250, 250)).toBe(250)
  })

  it('lässt eine Obergrenze über der Reihe nicht über die Reihe hinaus', () => {
    expect(replayStand(300, 500, 900)).toBe(300)
  })

  it('behandelt eine fehlende Obergrenze als „keine", nicht als null', () => {
    expect(replayStand(1000, 400, null)).toBe(400)
    expect(replayStand(1000, 400, undefined)).toBe(400)
  })

  it('fällt ohne Wunsch auf knapp zwei Drittel zurück (Charts ohne Trainer)', () => {
    const erwartet = Math.round(1000 * DEFAULT_START_FRACTION)
    expect(replayStand(1000, null, null)).toBe(erwartet)
    expect(replayStand(1000, undefined, null)).toBe(erwartet)
  })

  it('hält beim Rückfall die Mindestsicht ein', () => {
    // 20 Kerzen, 62 % davon wären 12 — darunter ist keine Analyse möglich.
    // Die Reihe selbst bleibt trotzdem die harte Grenze.
    expect(replayStand(20, null, null)).toBe(20)
    expect(replayStand(100, null, null)).toBeGreaterThanOrEqual(
      Math.min(MIN_VISIBLE_CANDLES, 100),
    )
  })

  it('bleibt bei mindestens einer Kerze', () => {
    expect(replayStand(1000, 0, null)).toBe(1)
    expect(replayStand(1000, -50, null)).toBe(1)
    expect(replayStand(1000, 500, 0)).toBe(1)
  })

  it('ergibt ohne Kerzen null', () => {
    expect(replayStand(0, 250, null)).toBe(0)
    expect(replayStand(Number.NaN, 250, null)).toBe(0)
  })

  it('rundet ungerade Eingaben statt sie abzulehnen', () => {
    expect(replayStand(1000, 249.6, null)).toBe(250)
    expect(replayStand(1000, Number.NaN, null)).toBe(
      Math.round(1000 * DEFAULT_START_FRACTION),
    )
  })
})

describe('startFenster', () => {
  it('zeigt den ganzen Vorlauf, solange er lesbar bleibt', () => {
    expect(startFenster(120)).toBe(120)
    expect(startFenster(MAX_START_FENSTER)).toBe(MAX_START_FENSTER)
  })

  it('deckelt einen langen Vorlauf auf ein lesbares Fenster', () => {
    // 800 Kerzen gleichzeitig wären Striche, keine Kerzen.
    expect(startFenster(800)).toBe(MAX_START_FENSTER)
    expect(startFenster(450)).toBe(MAX_START_FENSTER)
  })

  it('zeigt nie mehr, als freigegeben ist', () => {
    for (const n of [1, 5, 30, 199]) {
      expect(startFenster(n)).toBeLessThanOrEqual(n)
    }
  })

  it('ergibt ohne Freigabe null', () => {
    expect(startFenster(0)).toBe(0)
    expect(startFenster(-5)).toBe(0)
    expect(startFenster(Number.NaN)).toBe(0)
  })
})

describe('ansichtNeuSetzen', () => {
  const stand = (
    key: string,
    ersteZeit: number,
    hatteReplay = true,
  ): AnsichtStand => ({ key, ersteZeit, hatteReplay })

  it('setzt beim ersten Datensatz', () => {
    expect(
      ansichtNeuSetzen(null, { key: 'A|1h', ersteZeit: 100, replayFenster: true, len: 500 }),
    ).toBe(true)
  })

  it('laesst den Ausschnitt beim Abspielen in Ruhe', () => {
    // Der Replay laeuft: dieselbe Reihe waechst hinten, die erste Kerze bleibt.
    // Wer hier neu setzt, reisst dem Uebenden bei jeder Kerze den Zoom weg.
    const vorher = stand('A|1h', 100)
    for (const len of [121, 130, 400, 3000]) {
      expect(
        ansichtNeuSetzen(vorher, { key: 'A|1h', ersteZeit: 100, replayFenster: true, len }),
      ).toBe(false)
    }
  })

  it('setzt neu, wenn die Reihe ausgetauscht wurde (Zeitebenenwechsel)', () => {
    // Der Kern des Fehlers: Der Schluessel steht beim Wechsel sofort auf der
    // neuen Ebene, die Kerzen treffen erst danach ein. Erkannt wird der
    // Austausch an der ersten Kerze.
    const vorher = stand('A|4h', 100)
    expect(
      ansichtNeuSetzen(vorher, { key: 'A|4h', ersteZeit: 55_000, replayFenster: true, len: 2290 }),
    ).toBe(true)
  })

  it('setzt neu bei anderem Instrument oder anderer Ebene', () => {
    const vorher = stand('A|1h', 100)
    expect(
      ansichtNeuSetzen(vorher, { key: 'B|1h', ersteZeit: 100, replayFenster: true, len: 500 }),
    ).toBe(true)
    expect(
      ansichtNeuSetzen(vorher, { key: 'A|4h', ersteZeit: 100, replayFenster: true, len: 500 }),
    ).toBe(true)
  })

  it('zieht den spaet eintreffenden Replay-Startpunkt einmal nach', () => {
    const ohneReplay = stand('A|1h', 100, false)
    expect(
      ansichtNeuSetzen(ohneReplay, { key: 'A|1h', ersteZeit: 100, replayFenster: true, len: 3000 }),
    ).toBe(true)
    // ... aber nur einmal: danach ist `hatteReplay` wahr.
    expect(
      ansichtNeuSetzen(stand('A|1h', 100, true), {
        key: 'A|1h', ersteZeit: 100, replayFenster: true, len: 3000,
      }),
    ).toBe(false)
  })

  it('setzt nichts ohne Kerzen — und merkt sich dadurch auch nichts', () => {
    // Vorschnelles Merken war der zweite Teil des Fehlers: Es verbrauchte die
    // Gelegenheit, den Ausschnitt zu setzen, sobald die Kerzen da sind.
    for (const len of [0, 1]) {
      expect(
        ansichtNeuSetzen(null, { key: 'A|4h', ersteZeit: 0, replayFenster: true, len }),
      ).toBe(false)
    }
  })
})

describe('replaySkala', () => {
  it('spannt über die GANZE Reihe, auch wenn gesperrt ist', () => {
    // Der Fehler, um den es hier geht: Vor dem Loslassen war die Obergrenze der
    // Startpunkt, und der Regler endete dort. Der Griff stand am rechten
    // Anschlag — die Übung sah aus, als begänne sie am Ende.
    const s = replaySkala(1000, 250, 250)
    expect(s.max).toBe(1000)
    expect(s.wert).toBe(250)
    expect(s.grenze).toBe(250)
    expect(s.gesperrt).toBe(true)
  })

  it('meldet den gesperrten Anteil für die Schraffur', () => {
    const s = replaySkala(1000, 250, 250)
    // Von den 970 anwählbaren Kerzen (30 … 1000) liegen 750 hinter der Sperre.
    expect(s.sperrAnteil).toBeCloseTo(750 / 970, 6)
  })

  it('ohne Obergrenze ist nichts gesperrt', () => {
    const s = replaySkala(1000, 400, null)
    expect(s.gesperrt).toBe(false)
    expect(s.sperrAnteil).toBe(0)
    expect(s.grenze).toBe(1000)
    expect(s.wert).toBe(400)
  })

  it('klemmt einen Stand jenseits der Freigabe auf die Freigabe', () => {
    expect(replaySkala(1000, 900, 300).wert).toBe(300)
  })

  it('hält den kleinsten Stand ein', () => {
    expect(replaySkala(1000, 5, null).wert).toBe(REGLER_MIN)
    expect(replaySkala(1000, 5, null).min).toBe(REGLER_MIN)
  })

  it('verträgt eine kurze Reihe ohne Division durch null', () => {
    const s = replaySkala(20, 20, 20)
    expect(s.min).toBe(20)
    expect(s.max).toBe(20)
    expect(s.sperrAnteil).toBe(0)
  })

  it('verträgt eine leere Reihe', () => {
    const s = replaySkala(0, 0, null)
    expect(s.max).toBe(0)
    expect(s.wert).toBe(0)
    expect(s.gesperrt).toBe(false)
  })
})

describe('playAktion', () => {
  it('spielt, solange Luft bis zur Freigabe ist', () => {
    expect(playAktion(250, 300, true)).toBe('spielen')
    expect(playAktion(250, 300, false)).toBe('spielen')
  })

  it('lässt den noch nicht losgelassenen Durchlauf los', () => {
    // Genau der Moment beim Öffnen einer Übung: Stand = Freigabe = Startpunkt.
    expect(playAktion(250, 250, false)).toBe('loslassen')
  })

  it('tut am Haltepunkt eines laufenden Durchlaufs nichts', () => {
    // Die Frage daneben ist der Sinn des Haltepunkts — Play darf sie nicht
    // überspringen.
    expect(playAktion(300, 300, true)).toBe('blockiert')
  })
})
