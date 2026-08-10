import { describe, expect, it } from 'vitest'
import {
  clampStopEvery,
  computeInterventionCost,
  DEFAULT_STOP_EVERY,
  findEntryFill,
  fortschrittZeit,
  measureOutcome,
  measureStagedOutcome,
  nextStopAt,
  suggestRating,
  summarizeSession,
  validateTradeDraft,
  type TradeDraft,
} from './training-trade'
import type { Candle } from './market-data/types'

function candle(time: number, low: number, high: number, close = (low + high) / 2): Candle {
  return { time, open: close, high, low, close, volume: 0 }
}

const draft = (over: Partial<TradeDraft> = {}): TradeDraft => ({
  direction: 'long',
  entryPrice: 100,
  stopLoss: 90,
  takeProfit: 120,
  elliottCount: null,
  invalidation: null,
  thesisNote: null,
  setupTags: [],
  ...over,
})

describe('validateTradeDraft', () => {
  it('nimmt eine vollständige Long-These an', () => {
    expect(validateTradeDraft(draft(), 'frei')).toEqual([])
  })

  it('verlangt eine Richtung', () => {
    expect(validateTradeDraft(draft({ direction: null }), 'frei')).toEqual(['Richtung fehlt.'])
  })

  it('lässt „Kein Setup" ohne jede Marke zu', () => {
    const d = draft({ direction: 'keine', entryPrice: null, stopLoss: null, takeProfit: null })
    expect(validateTradeDraft(d, 'elliott')).toEqual([])
  })

  it('verlangt Einstieg, Stop und Ziel, sobald gehandelt wird', () => {
    const d = draft({ entryPrice: null, stopLoss: null, takeProfit: null })
    expect(validateTradeDraft(d, 'frei')).toEqual(['Einstieg fehlt.', 'Stop fehlt.', 'Ziel fehlt.'])
  })

  it('lehnt Stop gleich Einstieg ab — kein Risiko, kein R', () => {
    const f = validateTradeDraft(draft({ stopLoss: 100 }), 'frei')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatch(/kein Risiko/)
  })

  it('prüft die Seiten bei Long', () => {
    expect(validateTradeDraft(draft({ stopLoss: 110 }), 'frei')).toContain(
      'Bei Long muss der Stop unter dem Einstieg liegen.',
    )
    expect(validateTradeDraft(draft({ takeProfit: 80 }), 'frei')).toContain(
      'Bei Long muss das Ziel über dem Einstieg liegen.',
    )
  })

  it('prüft die Seiten bei Short', () => {
    const d = draft({ direction: 'short', entryPrice: 100, stopLoss: 110, takeProfit: 80 })
    expect(validateTradeDraft(d, 'frei')).toEqual([])
    expect(validateTradeDraft({ ...d, stopLoss: 90 }, 'frei')).toContain(
      'Bei Short muss der Stop über dem Einstieg liegen.',
    )
  })

  it('verlangt im Elliott-Modus Zählung und Invalidation', () => {
    const f = validateTradeDraft(draft(), 'elliott')
    expect(f).toEqual(['Wellenzählung fehlt.', 'Invalidation fehlt.'])
    expect(
      validateTradeDraft(draft({ elliottCount: 'Welle 3', invalidation: 89 }), 'elliott'),
    ).toEqual([])
  })
})

describe('measureOutcome', () => {
  const long = { direction: 'long' as const, entryPrice: 100, stopLoss: 90, takeProfit: 120 }

  it('erkennt das Ziel und rechnet R', () => {
    const m = measureOutcome(long, [candle(10, 99, 105), candle(20, 110, 121)], 5)!
    expect(m.outcome).toBe('ziel')
    expect(m.atTime).toBe(20)
    expect(m.rMultiple).toBeCloseTo(2) // 20 Gewinn / 10 Risiko
    expect(m.ambiguous).toBe(false)
  })

  it('erkennt den Stop', () => {
    const m = measureOutcome(long, [candle(10, 89, 105)], 5)!
    expect(m.outcome).toBe('stop')
    expect(m.rMultiple).toBeCloseTo(-1)
  })

  it('nimmt bei Stop UND Ziel in derselben Kerze den Stop und weist es aus', () => {
    const m = measureOutcome(long, [candle(10, 89, 121)], 5)!
    expect(m.outcome).toBe('stop')
    expect(m.ambiguous).toBe(true)
  })

  it('lässt die Einstiegskerze selbst außen vor', () => {
    // Die Kerze BEI fromSec enthält Bewegung von vor dem Einstieg.
    const m = measureOutcome(long, [candle(5, 80, 130), candle(10, 99, 105)], 5)!
    expect(m.outcome).toBe('offen')
  })

  it('meldet „offen", wenn nichts berührt wurde', () => {
    const m = measureOutcome(long, [candle(10, 99, 105, 104)], 5)!
    expect(m.outcome).toBe('offen')
    expect(m.exitPrice).toBe(104)
    expect(m.rMultiple).toBeCloseTo(0.4)
  })

  it('rechnet bei Short in die andere Richtung', () => {
    const short = { direction: 'short' as const, entryPrice: 100, stopLoss: 110, takeProfit: 80 }
    const m = measureOutcome(short, [candle(10, 79, 95)], 5)!
    expect(m.outcome).toBe('ziel')
    expect(m.rMultiple).toBeCloseTo(2) // (100-80)/10
  })

  it('gibt null zurück, wenn nichts messbar ist', () => {
    expect(measureOutcome(long, [], 5)).toBeNull()
    expect(measureOutcome(long, [candle(1, 90, 110)], 5)).toBeNull() // nur davor
    expect(
      measureOutcome({ ...long, stopLoss: 100 }, [candle(10, 90, 110)], 5),
    ).toBeNull() // kein Risiko
    expect(
      measureOutcome({ ...long, direction: 'keine' }, [candle(10, 90, 110)], 5),
    ).toBeNull()
  })
})

describe('nextStopAt', () => {
  it('hält alle N Kerzen ab dem Startpunkt', () => {
    expect(nextStopAt(100, 100, 200, 'auto', 10)).toBe(110)
    expect(nextStopAt(105, 100, 200, 'auto', 10)).toBe(110)
    expect(nextStopAt(110, 100, 200, 'auto', 10)).toBe(120)
  })

  it('kennt im manuellen Modus keinen Halt', () => {
    expect(nextStopAt(100, 100, 200, 'manuell', 10)).toBeNull()
  })

  it('läuft nicht über das Ende hinaus', () => {
    expect(nextStopAt(195, 100, 200, 'auto', 10)).toBe(200)
    expect(nextStopAt(200, 100, 200, 'auto', 10)).toBeNull()
  })
})

describe('clampStopEvery', () => {
  it('hält den Abstand im sinnvollen Bereich', () => {
    expect(clampStopEvery(10)).toBe(10)
    expect(clampStopEvery(1)).toBe(3)
    expect(clampStopEvery(9999)).toBe(100)
    expect(clampStopEvery('viel')).toBe(DEFAULT_STOP_EVERY)
    expect(clampStopEvery(null)).toBe(DEFAULT_STOP_EVERY)
  })
})

describe('suggestRating', () => {
  it('schlägt vor, entscheidet aber nichts', () => {
    expect(suggestRating('ziel')).toBe('korrekt')
    expect(suggestRating('stop')).toBe('falsch')
    expect(suggestRating('offen')).toBe('teilweise')
  })
})

describe('computeInterventionCost', () => {
  const trades = [
    { id: 1, outcome: 'ziel' as const, rMultiple: 2 },
    { id: 2, outcome: 'stop' as const, rMultiple: -1 },
    { id: 3, outcome: 'ziel' as const, rMultiple: 1.5 },
  ]

  it('zählt, was ein Ausstieg gekostet hätte', () => {
    const k = computeInterventionCost(trades, [
      { tradeId: 1, decision: 'raus' },
      { tradeId: 2, decision: 'raus' },
      { tradeId: 3, decision: 'haelt' },
    ])
    expect(k.ausstiege).toBe(2)
    expect(k.waerenAufgegangen).toBe(1)
    expect(k.entgangenR).toBeCloseTo(2)
    expect(k.richtigGewesen).toBe(1)
  })

  it('zählt denselben Trade nur einmal, auch bei mehrfachem Ausstiegswunsch', () => {
    const k = computeInterventionCost(trades, [
      { tradeId: 1, decision: 'raus' },
      { tradeId: 1, decision: 'raus' },
      { tradeId: 1, decision: 'raus' },
    ])
    expect(k.ausstiege).toBe(1)
    expect(k.entgangenR).toBeCloseTo(2)
  })

  it('ignoriert Haltepunkte ohne Trade und ohne Ergebnis', () => {
    const k = computeInterventionCost(
      [{ id: 9, outcome: null, rMultiple: null }],
      [
        { tradeId: null, decision: 'kein_setup' },
        { tradeId: 9, decision: 'raus' },
        { tradeId: 99, decision: 'raus' },
      ],
    )
    expect(k.ausstiege).toBe(0)
    expect(k.entgangenR).toBe(0)
  })

  it('bleibt bei null, wenn nie ausgestiegen werden wollte', () => {
    const k = computeInterventionCost(trades, [
      { tradeId: 1, decision: 'haelt' },
      { tradeId: 2, decision: 'gedreht' },
    ])
    expect(k).toEqual({
      ausstiege: 0,
      waerenAufgegangen: 0,
      entgangenR: 0,
      richtigGewesen: 0,
    })
  })
})

describe('summarizeSession', () => {
  it('zählt Ergebnisse und summiert R', () => {
    const s = summarizeSession([
      { outcome: 'ziel', rMultiple: 2 },
      { outcome: 'stop', rMultiple: -1 },
      { outcome: 'ziel', rMultiple: 1.5 },
      { outcome: 'offen', rMultiple: 0.2 },
    ])
    expect(s.entschieden).toBe(4)
    expect(s.ziel).toBe(2)
    expect(s.stop).toBe(1)
    expect(s.offen).toBe(1)
    expect(s.summeR).toBeCloseTo(2.7)
    expect(s.quote).toBeCloseTo(50)
  })

  it('hält Enthaltungen aus der Quote heraus', () => {
    const s = summarizeSession([
      { outcome: 'ziel', rMultiple: 1 },
      { outcome: null, rMultiple: null },
      { outcome: null, rMultiple: null },
    ])
    expect(s.keinSetup).toBe(2)
    expect(s.entschieden).toBe(1)
    // Nicht 33 % — sich bewusst herauszuhalten ist kein Fehlschlag.
    expect(s.quote).toBe(100)
  })

  it('zeigt ohne entschiedenen Trade keine Quote', () => {
    expect(summarizeSession([]).quote).toBeNull()
    expect(summarizeSession([{ outcome: null, rMultiple: null }]).quote).toBeNull()
  })
})

describe('fortschrittZeit', () => {
  it('nimmt die spaeteste gesehene Kerze', () => {
    expect(fortschrittZeit([100, 300, 200])).toBe(300)
  })

  it('ignoriert fehlende und unbrauchbare Werte', () => {
    expect(fortschrittZeit([null, 250, undefined, Number.NaN])).toBe(250)
  })

  it('ergibt null, wenn nichts gesehen wurde', () => {
    expect(fortschrittZeit([])).toBe(null)
    expect(fortschrittZeit([null, undefined])).toBe(null)
  })
})

describe('measureStagedOutcome — Teilziele', () => {
  // Long 100, Stop 90 (Risiko 10), zwei Stufen: 110 (50 %) und 130 (50 %).
  const gestaffelt = {
    direction: 'long' as const,
    entryPrice: 100,
    stopLoss: 90,
    targets: [
      { price: 110, sharePct: 50 },
      { price: 130, sharePct: 50 },
    ],
    stopAufEinstand: true,
  }

  it('rechnet beide Stufen gewichtet, wenn alles durchläuft', () => {
    const m = measureStagedOutcome(
      gestaffelt,
      [candle(10, 99, 111), candle(20, 108, 131)],
      5,
    )!
    expect(m.outcome).toBe('ziel')
    expect(m.reachedTarget).toBe(2)
    // 0,5 × 1R + 0,5 × 3R = 2R
    expect(m.rMultiple).toBeCloseTo(2, 6)
    expect(m.exits.map((e) => e.stufe)).toEqual([1, 2])
  })

  it('zieht den Stop nach der ersten Stufe auf den Einstand', () => {
    // Kerze 1 nimmt TP1 mit, Kerze 2 fällt bis 95 — der URSPRÜNGLICHE Stop bei
    // 90 wird nicht berührt, der auf 100 gezogene schon.
    const m = measureStagedOutcome(
      gestaffelt,
      [candle(10, 99, 111), candle(20, 95, 105)],
      5,
    )!
    expect(m.reachedTarget).toBe(1)
    // 0,5 × 1R (TP1) + 0,5 × 0R (Einstand) = 0,5R
    expect(m.rMultiple).toBeCloseTo(0.5, 6)
    expect(m.exits[1]).toMatchObject({ stufe: 0, preis: 100 })
    // Nach Absprache gilt ein mitgenommenes Teilziel als Treffer.
    expect(m.outcome).toBe('ziel')
  })

  it('bleibt ohne erreichte Stufe ein Stop mit vollem Verlust', () => {
    const m = measureStagedOutcome(gestaffelt, [candle(10, 89, 105)], 5)!
    expect(m.outcome).toBe('stop')
    expect(m.reachedTarget).toBe(0)
    expect(m.rMultiple).toBeCloseTo(-1, 6)
  })

  it('lässt in derselben Kerze den Stop gewinnen und meldet die Unschärfe', () => {
    const m = measureStagedOutcome(gestaffelt, [candle(10, 89, 131)], 5)!
    expect(m.outcome).toBe('stop')
    expect(m.ambiguous).toBe(true)
    expect(m.rMultiple).toBeCloseTo(-1, 6)
  })

  it('bewertet einen nicht abgeschlossenen Rest zum letzten Kurs', () => {
    const m = measureStagedOutcome(
      gestaffelt,
      [candle(10, 99, 111), candle(20, 105, 115, 112)],
      5,
    )!
    expect(m.reachedTarget).toBe(1)
    // 0,5 × 1R + 0,5 × 1,2R = 1,1R
    expect(m.rMultiple).toBeCloseTo(1.1, 6)
  })

  it('rechnet Short spiegelbildlich und sortiert die Stufen nach Abstand', () => {
    const m = measureStagedOutcome(
      {
        direction: 'short',
        entryPrice: 100,
        stopLoss: 110,
        // Absichtlich verkehrt herum eingegeben — die nächste Stufe ist 90.
        targets: [
          { price: 70, sharePct: 50 },
          { price: 90, sharePct: 50 },
        ],
        stopAufEinstand: false,
      },
      [candle(10, 89, 101), candle(20, 69, 95)],
      5,
    )!
    expect(m.exits.map((e) => e.preis)).toEqual([90, 70])
    // 0,5 × 1R + 0,5 × 3R = 2R
    expect(m.rMultiple).toBeCloseTo(2, 6)
  })

  it('lässt einen Restanteil weiterlaufen, wenn die Summe unter 100 % bleibt', () => {
    const m = measureStagedOutcome(
      {
        direction: 'long',
        entryPrice: 100,
        stopLoss: 90,
        targets: [{ price: 110, sharePct: 40 }],
        stopAufEinstand: false,
      },
      [candle(10, 99, 111), candle(20, 108, 120, 120)],
      5,
    )!
    // 0,4 × 1R + 0,6 × 2R = 1,6R
    expect(m.rMultiple).toBeCloseTo(1.6, 6)
    expect(m.exits).toHaveLength(2)
  })

  it('misst nichts ohne Risiko, ohne Stufen oder ohne Kerzen danach', () => {
    const basis = { direction: 'long' as const, entryPrice: 100, stopLoss: 90, stopAufEinstand: false }
    expect(
      measureStagedOutcome({ ...basis, stopLoss: 100, targets: [{ price: 110, sharePct: 100 }] }, [candle(10, 99, 111)], 5),
    ).toBeNull()
    expect(measureStagedOutcome({ ...basis, targets: [] }, [candle(10, 99, 111)], 5)).toBeNull()
    expect(
      measureStagedOutcome({ ...basis, targets: [{ price: 110, sharePct: 100 }] }, [candle(1, 99, 111)], 5),
    ).toBeNull()
  })

  it('bleibt für eine einzige Stufe deckungsgleich mit measureOutcome', () => {
    const kerzen = [candle(10, 99, 105), candle(20, 110, 121)]
    const alt = measureOutcome(
      { direction: 'long', entryPrice: 100, stopLoss: 90, takeProfit: 120 },
      kerzen,
      5,
    )!
    const neu = measureStagedOutcome(
      {
        direction: 'long',
        entryPrice: 100,
        stopLoss: 90,
        targets: [{ price: 120, sharePct: 100 }],
        stopAufEinstand: false,
      },
      kerzen,
      5,
    )!
    expect(neu.outcome).toBe(alt.outcome)
    expect(neu.exitPrice).toBe(alt.exitPrice)
    expect(neu.rMultiple).toBeCloseTo(alt.rMultiple, 6)
  })
})

describe('findEntryFill — die liegende Order', () => {
  const order = { direction: 'long' as const, entryPrice: 95 }
  // Auftrag bei Schlusskurs 100 (Kerze zur Zeit 5), Einstieg 95 → von oben.
  const auftrag = candle(5, 99, 101, 100)

  it('löst aus, sobald der Kurs den Einstieg berührt', () => {
    const f = findEntryFill(order, [auftrag, candle(10, 98, 102), candle(20, 94, 99)], 5)!
    expect(f.status).toBe('ausgeloest')
    expect(f.atTime).toBe(20)
  })

  it('meldet „nicht ausgelöst", wenn der Kurs nie hinkommt', () => {
    const f = findEntryFill(order, [auftrag, candle(10, 98, 102), candle(20, 97, 105)], 5)!
    expect(f.status).toBe('nicht_ausgeloest')
    expect(f.atTime).toBeNull()
  })

  it('stirbt am Invalidierungsniveau, bevor der Einstieg kommt', () => {
    const f = findEntryFill(
      { ...order, orderInvalidation: 108 },
      [auftrag, candle(10, 100, 109), candle(20, 94, 99)],
      5,
    )!
    expect(f.status).toBe('invalidiert')
    expect(f.atTime).toBe(10)
  })

  it('lässt bei Einstieg UND Invalidierung in derselben Kerze den Einstieg gelten', () => {
    // Die unbequeme Annahme: Der Trade findet statt und kann verlieren, statt
    // sich als „gar nicht gehandelt" aus der Quote zu stehlen.
    const f = findEntryFill(
      { ...order, orderInvalidation: 108 },
      [auftrag, candle(10, 94, 109)],
      5,
    )!
    expect(f.status).toBe('ausgeloest')
    expect(f.atTime).toBe(10)
  })

  it('gilt sofort als drin, wenn der Einstieg auf dem Auftragskurs liegt', () => {
    const f = findEntryFill({ direction: 'long', entryPrice: 100 }, [auftrag, candle(10, 99, 101)], 5)!
    expect(f.status).toBe('ausgeloest')
    expect(f.atTime).toBe(10)
  })

  it('misst nicht ohne Kerzen nach dem Auftrag', () => {
    expect(findEntryFill(order, [auftrag], 5)).toBeNull()
    expect(findEntryFill({ ...order, direction: 'keine' }, [auftrag, candle(10, 94, 99)], 5)).toBeNull()
  })
})

describe('summarizeSession — nicht gehandelte Orders', () => {
  it('hält gestrichene, nie ausgelöste und invalidierte aus der Quote heraus', () => {
    const b = summarizeSession([
      { outcome: 'ziel', rMultiple: 2, orderStatus: 'ausgeloest' },
      { outcome: 'stop', rMultiple: -1, orderStatus: 'ausgeloest' },
      { outcome: null, rMultiple: null, orderStatus: 'gestrichen' },
      { outcome: null, rMultiple: null, orderStatus: 'nicht_ausgeloest' },
      { outcome: null, rMultiple: null, orderStatus: 'invalidiert' },
    ])
    expect(b.entschieden).toBe(2)
    expect(b.nichtGehandelt).toBe(3)
    expect(b.quote).toBe(50)
    // Genau das war der Messfehler: Ohne die Trennung stünden hier 5 Zeilen in
    // der Quote, von denen drei nie ein Trade waren.
    expect(b.summeR).toBeCloseTo(1, 6)
  })

  it('zählt eine noch liegende Order nirgends mit', () => {
    const b = summarizeSession([
      { outcome: 'ziel', rMultiple: 1, orderStatus: 'ausgeloest' },
      { outcome: null, rMultiple: null, orderStatus: 'liegt' },
    ])
    expect(b.entschieden).toBe(1)
    expect(b.keinSetup).toBe(0)
    expect(b.nichtGehandelt).toBe(0)
    expect(b.quote).toBe(100)
  })

  it('behandelt Zeilen ohne Order-Status wie ausgeführt (Altbestand)', () => {
    const b = summarizeSession([
      { outcome: 'ziel', rMultiple: 1 },
      { outcome: null, rMultiple: null },
    ])
    expect(b.entschieden).toBe(1)
    expect(b.keinSetup).toBe(1)
    expect(b.nichtGehandelt).toBe(0)
  })
})
