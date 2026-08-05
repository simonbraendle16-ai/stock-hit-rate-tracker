import { describe, expect, it } from 'vitest'
import { MAX_START_FENSTER, replayStand, startFenster } from './replay-start'
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
