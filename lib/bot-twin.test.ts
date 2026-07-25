import { describe, expect, it } from 'vitest'
import {
  BOT_INTERVALS,
  BUCKET_EPS,
  classifyDifference,
  compareBotAndTrader,
  intervalLabel,
  manualOutcomeRun,
  preferredInterval,
  simulateMissedTrade,
  simulateTrade,
  type BotRun,
  type BotTrade,
  type BotTwinEntry,
} from '@/lib/bot-twin'
import type { Candle } from '@/lib/market-data/types'

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const HOUR = 3600
const T0 = 1_700_000_000 // fester Zeitanker, damit nichts von „heute" abhängt

/** Kerze mit Kürzeln: [offset in Stunden, open, high, low, close] */
function candle(offsetH: number, open: number, high: number, low: number, close: number): Candle {
  return { time: T0 + offsetH * HOUR, open, high, low, close, volume: 0 }
}

function longTrade(over: Partial<BotTrade> = {}): BotTrade {
  return {
    id: 1,
    ticker: 'TEST',
    direction: 'long',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    quantity: 10,
    fees: 0,
    plannedRisk: 100, // |100 − 90| × 10
    fromSec: T0,
    ...over,
  }
}

function shortTrade(over: Partial<BotTrade> = {}): BotTrade {
  return longTrade({
    direction: 'short',
    entryPrice: 100,
    stopLoss: 110,
    takeProfit: 80,
    plannedRisk: 100,
    ...over,
  })
}

/** Enger Typzugriff auf einen erfolgreichen Lauf. */
function ok(run: BotRun) {
  if (!run.simulated) throw new Error(`Simulation fehlgeschlagen: ${run.reason}`)
  return run
}

// ---------------------------------------------------------------------------
// simulateTrade — die vier Regeln
// ---------------------------------------------------------------------------

describe('simulateTrade — Long', () => {
  it('beendet den Trade exakt am Stop, wenn der Stop zuerst berührt wird', () => {
    const run = ok(
      simulateTrade(longTrade(), [
        candle(0, 100, 105, 98, 102),
        candle(1, 102, 103, 89, 91), // Stop bei 90 berührt
        candle(2, 91, 130, 91, 129), // Ziel danach — darf nicht mehr zählen
      ]),
    )

    expect(run.outcome).toBe('stop')
    expect(run.exitPrice).toBe(90)
    expect(run.grossPnl).toBe(-100)
    expect(run.rMultiple).toBe(-1)
    expect(run.ambiguous).toBe(false)
    expect(run.candlesUsed).toBe(2)
  })

  it('beendet den Trade exakt am Ziel, wenn das Ziel zuerst berührt wird', () => {
    const run = ok(
      simulateTrade(longTrade(), [
        candle(0, 100, 105, 98, 102),
        candle(1, 102, 121, 101, 119), // Ziel bei 120 berührt
        candle(2, 119, 119, 80, 85), // späterer Absturz zählt nicht mehr
      ]),
    )

    expect(run.outcome).toBe('ziel')
    expect(run.exitPrice).toBe(120)
    expect(run.grossPnl).toBe(200)
    expect(run.rMultiple).toBe(2)
  })

  it('wertet Stop und Ziel in derselben Kerze konservativ als Stop und meldet es', () => {
    const run = ok(simulateTrade(longTrade(), [candle(0, 100, 125, 88, 110)]))

    expect(run.outcome).toBe('stop')
    expect(run.exitPrice).toBe(90)
    expect(run.rMultiple).toBe(-1)
    expect(run.ambiguous).toBe(true)
  })

  it('bewertet einen weder gestoppten noch gezielten Trade offen zum letzten Kurs', () => {
    const run = ok(
      simulateTrade(longTrade(), [
        candle(0, 100, 105, 98, 102),
        candle(1, 102, 108, 99, 107),
      ]),
    )

    expect(run.outcome).toBe('offen')
    expect(run.exitPrice).toBe(107)
    expect(run.grossPnl).toBe(70)
    expect(run.rMultiple).toBeCloseTo(0.7, 10)
  })

  it('läuft bewusst über den echten Ausstieg hinaus bis zum Ziel', () => {
    // Genau der Fall „zu früh ausgestiegen": nach der ersten Kerze war der Trader
    // raus, der Plan wäre zwei Kerzen später im Ziel gewesen.
    const run = ok(
      simulateTrade(longTrade(), [
        candle(0, 100, 103, 99, 101),
        candle(1, 101, 110, 100, 109),
        candle(2, 109, 122, 108, 121),
      ]),
    )

    expect(run.outcome).toBe('ziel')
    expect(run.rMultiple).toBe(2)
  })
})

describe('simulateTrade — Short', () => {
  it('stoppt oberhalb des Einstiegs', () => {
    const run = ok(
      simulateTrade(shortTrade(), [
        candle(0, 100, 105, 95, 98),
        candle(1, 98, 112, 97, 111), // Stop bei 110 berührt
      ]),
    )

    expect(run.outcome).toBe('stop')
    expect(run.exitPrice).toBe(110)
    expect(run.grossPnl).toBe(-100) // (110 − 100) × −10
    expect(run.rMultiple).toBe(-1)
  })

  it('erreicht das Ziel unterhalb des Einstiegs', () => {
    const run = ok(
      simulateTrade(shortTrade(), [
        candle(0, 100, 102, 95, 96),
        candle(1, 96, 97, 79, 81), // Ziel bei 80 berührt
      ]),
    )

    expect(run.outcome).toBe('ziel')
    expect(run.exitPrice).toBe(80)
    expect(run.grossPnl).toBe(200) // (80 − 100) × −10
    expect(run.rMultiple).toBe(2)
  })

  it('wertet auch beim Short die Doppelberührung als Stop', () => {
    const run = ok(simulateTrade(shortTrade(), [candle(0, 100, 115, 75, 90)]))
    expect(run.outcome).toBe('stop')
    expect(run.ambiguous).toBe(true)
  })
})

describe('simulateTrade — Gebühren und Nenner', () => {
  it('zieht die eingefrorenen Gebühren vom Ergebnis ab', () => {
    const run = ok(
      simulateTrade(longTrade({ fees: 14 }), [candle(0, 100, 121, 99, 120)]),
    )

    expect(run.grossPnl).toBe(200)
    expect(run.netPnl).toBe(186)
    expect(run.rMultiple).toBeCloseTo(1.86, 10)
  })

  it('rechnet R gegen das übergebene geplante Risiko, nicht gegen die Stopdistanz', () => {
    // Ein Trade mit Teilverkäufen bringt sein 1 R aus dem Settlement mit; der Bot
    // muss denselben Nenner benutzen, sonst stehen beide Seiten auf anderem Maß.
    const run = ok(simulateTrade(longTrade({ plannedRisk: 50 }), [candle(0, 100, 121, 99, 120)]))
    expect(run.rMultiple).toBe(4)
  })
})

describe('simulateTrade — was nicht simuliert werden kann', () => {
  it('lehnt Trades ohne Ziel ab', () => {
    expect(simulateTrade(longTrade({ takeProfit: null }), [candle(0, 100, 105, 95, 102)])).toEqual({
      simulated: false,
      reason: 'kein_ziel',
    })
  })

  it('lehnt Trades ohne Risikodistanz ab', () => {
    expect(simulateTrade(longTrade({ plannedRisk: 0 }), [candle(0, 100, 105, 95, 102)])).toEqual({
      simulated: false,
      reason: 'kein_risiko',
    })
  })

  it('lehnt Trades ohne Einstiegszeitpunkt ab', () => {
    expect(simulateTrade(longTrade({ fromSec: 0 }), [candle(0, 100, 105, 95, 102)])).toEqual({
      simulated: false,
      reason: 'kein_zeitpunkt',
    })
  })

  it('meldet fehlende Kursdaten', () => {
    expect(simulateTrade(longTrade(), [])).toEqual({ simulated: false, reason: 'keine_kerzen' })
  })

  it('meldet eine Historie, die nicht bis zum Einstieg zurückreicht', () => {
    // Alle Kerzen beginnen NACH dem Einstieg — die Kerze mit dem Stop könnte fehlen.
    const run = simulateTrade(longTrade({ fromSec: T0 - 100 * HOUR }), [
      candle(0, 100, 105, 98, 102),
    ])
    expect(run).toEqual({ simulated: false, reason: 'historie_zu_kurz' })
  })

  it('meldet eine Historie, die vor dem Einstieg endet', () => {
    const run = simulateTrade(longTrade({ fromSec: T0 + 50 * HOUR }), [
      candle(0, 100, 105, 98, 102),
      candle(1, 102, 106, 99, 104),
    ])
    expect(run).toEqual({ simulated: false, reason: 'historie_zu_kurz' })
  })

  it('ignoriert Kerzen vor dem Einstieg statt sie mitzurechnen', () => {
    // Der Absturz auf 85 liegt VOR dem Einstieg — er darf den Stop nicht auslösen.
    const run = ok(
      simulateTrade(longTrade({ fromSec: T0 + 2 * HOUR }), [
        candle(0, 100, 101, 85, 88),
        candle(1, 88, 101, 87, 100),
        candle(2, 100, 121, 99, 120),
      ]),
    )
    expect(run.outcome).toBe('ziel')
  })

  it('überspringt unbrauchbare Kerzen (NaN) und sortiert unsortierte Reihen', () => {
    const broken = { ...candle(1, 100, NaN, NaN, NaN) }
    const run = ok(
      simulateTrade(longTrade(), [candle(2, 100, 121, 99, 120), broken, candle(0, 100, 105, 98, 102)]),
    )
    expect(run.outcome).toBe('ziel')
    expect(run.candlesUsed).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// simulateMissedTrade — geplant, nie eingegangen
// ---------------------------------------------------------------------------

describe('simulateMissedTrade', () => {
  it('meldet einen nie erreichten Einstieg', () => {
    // Einstieg 100 liegt unter dem Kurs; der Kurs fällt nie so weit.
    const run = simulateMissedTrade(longTrade({ entryPrice: 100 }), [
      candle(0, 110, 115, 105, 112),
      candle(1, 112, 118, 108, 116),
    ])
    expect(run).toEqual({ simulated: false, reason: 'nicht_ausgeloest' })
  })

  it('rechnet ab der Kerze, in der der Einstieg erreicht wurde', () => {
    const run = ok(
      simulateMissedTrade(longTrade(), [
        candle(0, 110, 115, 105, 112), // noch kein Einstieg
        candle(1, 112, 113, 99, 101), // Einstieg 100 berührt
        candle(2, 101, 121, 100, 120), // Ziel
      ]),
    )
    expect(run.outcome).toBe('ziel')
    expect(run.rMultiple).toBe(2)
  })

  it('lässt den Stop auch in der Einstiegskerze greifen', () => {
    const run = ok(
      simulateMissedTrade(longTrade(), [
        candle(0, 110, 115, 105, 112),
        candle(1, 112, 113, 88, 95), // Einstieg UND Stop in derselben Kerze
      ]),
    )
    expect(run.outcome).toBe('stop')
    expect(run.rMultiple).toBe(-1)
  })

  it('wertet einen Einstieg auf Höhe des Bezugskurses als sofort erreicht', () => {
    const run = ok(
      simulateMissedTrade(longTrade({ entryPrice: 100 }), [
        candle(0, 100, 104, 99, 100), // Schluss exakt auf dem Einstieg
        candle(1, 100, 121, 100, 120),
      ]),
    )
    expect(run.outcome).toBe('ziel')
  })
})

// ---------------------------------------------------------------------------
// Nachgetragene Ausgänge
// ---------------------------------------------------------------------------

describe('manualOutcomeRun', () => {
  it('nimmt beim Ziel den Plan-Kurs, nicht einen frei eingegebenen', () => {
    const run = ok(manualOutcomeRun(longTrade({ fees: 10 }), 'ziel', 999))
    expect(run.exitPrice).toBe(120)
    expect(run.netPnl).toBe(190)
    expect(run.rMultiple).toBeCloseTo(1.9, 10)
  })

  it('nimmt beim Stop den Plan-Stop', () => {
    const run = ok(manualOutcomeRun(longTrade(), 'stop', null))
    expect(run.exitPrice).toBe(90)
    expect(run.rMultiple).toBe(-1)
  })

  it('braucht für einen offenen Ausgang einen Kurs', () => {
    expect(manualOutcomeRun(longTrade(), 'offen', null)).toEqual({
      simulated: false,
      reason: 'keine_kerzen',
    })
    const run = ok(manualOutcomeRun(longTrade(), 'offen', 110))
    expect(run.exitPrice).toBe(110)
    expect(run.rMultiple).toBe(1)
  })

  it('lehnt ein Ziel ab, das im Plan gar nicht steht', () => {
    expect(manualOutcomeRun(longTrade({ takeProfit: null }), 'ziel', null)).toEqual({
      simulated: false,
      reason: 'kein_ziel',
    })
  })

  it('rechnet auch beim Short mit dem richtigen Vorzeichen', () => {
    const run = ok(manualOutcomeRun(shortTrade(), 'ziel', null))
    expect(run.exitPrice).toBe(80)
    expect(run.rMultiple).toBe(2)
  })

  it('markiert einen Nachtrag nie als uneindeutig', () => {
    expect(ok(manualOutcomeRun(longTrade(), 'stop', null)).ambiguous).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Zuordnung der Differenz
// ---------------------------------------------------------------------------

describe('classifyDifference', () => {
  it('nennt eine Differenz unter der Schwelle plan-konform', () => {
    expect(classifyDifference(BUCKET_EPS / 2, 'ziel', [])).toBe('wie_geplant')
    expect(classifyDifference(-BUCKET_EPS / 2, 'stop', [])).toBe('wie_geplant')
  })

  it('erkennt ein besseres Ergebnis als der Plan', () => {
    expect(classifyDifference(1.4, 'stop', [])).toBe('besser_als_plan')
  })

  it('erklärt eine Differenz vorrangig mit dem dokumentierten Regelbruch', () => {
    expect(classifyDifference(-1.2, 'ziel', ['stop_moved'])).toBe('stop_verschoben')
  })

  it('nennt es „zu spät", wenn der Bot am Stop raus wäre und du mehr verloren hast', () => {
    expect(classifyDifference(-0.9, 'stop', [])).toBe('zu_spaet')
  })

  it('nennt es „zu früh", wenn der Plan weitergelaufen wäre', () => {
    expect(classifyDifference(-1.8, 'ziel', [])).toBe('zu_frueh')
    expect(classifyDifference(-0.4, 'offen', [])).toBe('zu_frueh')
  })
})

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function entry(over: Partial<BotTwinEntry> & { run: BotRun }): BotTwinEntry {
  return {
    tradeId: 1,
    ticker: 'TEST',
    label: '01.01.',
    realR: 0,
    violations: [],
    source: 'kurse',
    resolution: '1day',
    hasTarget: true,
    manual: null,
    ...over,
  }
}

function run(
  rMultiple: number,
  outcome: 'ziel' | 'stop' | 'offen' = 'ziel',
): Extract<BotRun, { simulated: true }> {
  return {
    simulated: true,
    outcome,
    exitPrice: 0,
    exitSec: T0,
    grossPnl: 0,
    netPnl: 0,
    rMultiple,
    candlesUsed: 1,
    ambiguous: false,
  }
}

describe('compareBotAndTrader', () => {
  it('summiert beide Seiten und bildet die Differenz', () => {
    const stats = compareBotAndTrader([
      entry({ tradeId: 1, realR: 1, run: run(2) }),
      entry({ tradeId: 2, realR: -1, run: run(-1, 'stop') }),
      entry({ tradeId: 3, realR: 0.5, run: run(3) }),
    ])

    expect(stats.compared).toBe(3)
    expect(stats.botTotalR).toBeCloseTo(4, 10)
    expect(stats.realTotalR).toBeCloseTo(0.5, 10)
    // Deine Seite minus Bot: das Eingreifen hat 3,5 R gekostet.
    expect(stats.differenceR).toBeCloseTo(-3.5, 10)
  })

  it('lässt die Differenz auch positiv werden — besser als der Plan ist ein Befund', () => {
    const stats = compareBotAndTrader([
      entry({ tradeId: 1, realR: 3, run: run(-1, 'stop') }),
    ])
    expect(stats.differenceR).toBeCloseTo(4, 10)
    expect(stats.buckets).toEqual([{ bucket: 'besser_als_plan', trades: 1, r: 4 }])
  })

  it('verteilt jeden Trade in genau einen Eimer, dessen Summe die Differenz ergibt', () => {
    const stats = compareBotAndTrader([
      entry({ tradeId: 1, realR: 0.4, run: run(2) }), // zu früh: −1,6
      entry({ tradeId: 2, realR: -2, run: run(-1, 'stop') }), // zu spät: −1
      entry({ tradeId: 3, realR: 0, run: run(1.5), violations: ['stop_moved'] }), // −1,5
      entry({ tradeId: 4, realR: 2, run: run(2) }), // wie geplant: 0
      entry({ tradeId: 5, realR: 1, run: run(-1, 'stop') }), // besser: +2
    ])

    const byBucket = Object.fromEntries(stats.buckets.map((b) => [b.bucket, b]))
    expect(byBucket.zu_frueh).toMatchObject({ trades: 1 })
    expect(byBucket.zu_frueh.r).toBeCloseTo(-1.6, 10)
    expect(byBucket.zu_spaet.r).toBeCloseTo(-1, 10)
    expect(byBucket.stop_verschoben.r).toBeCloseTo(-1.5, 10)
    expect(byBucket.wie_geplant.r).toBeCloseTo(0, 10)
    expect(byBucket.besser_als_plan.r).toBeCloseTo(2, 10)

    const bucketSum = stats.buckets.reduce((a, b) => a + b.r, 0)
    expect(bucketSum).toBeCloseTo(stats.differenceR, 10)
    expect(stats.buckets.reduce((a, b) => a + b.trades, 0)).toBe(stats.compared)
  })

  it('führt nicht simulierbare Trades als Lücke, statt sie zu verschweigen', () => {
    const stats = compareBotAndTrader(
      [
        entry({ tradeId: 1, realR: 1, run: run(2) }),
        entry({ tradeId: 2, realR: -1, run: { simulated: false, reason: 'keine_kerzen' } }),
      ],
      [],
      5,
    )

    expect(stats.compared).toBe(1)
    expect(stats.closed).toBe(5)
    expect(stats.gaps).toEqual([
      {
        tradeId: 2,
        ticker: 'TEST',
        label: '01.01.',
        reason: 'keine_kerzen',
        realR: -1,
        hasTarget: true,
        manual: null,
      },
    ])
    // Die Lücke darf in keine Summe einfließen.
    expect(stats.botTotalR).toBe(2)
    expect(stats.realTotalR).toBe(1)
  })

  it('baut zwei kumulierte Kurven, die bei 0 starten', () => {
    const stats = compareBotAndTrader([
      entry({ tradeId: 1, label: '01.02.', realR: 1, run: run(2) }),
      entry({ tradeId: 2, label: '05.02.', realR: -1, run: run(-1, 'stop') }),
    ])

    expect(stats.points).toEqual([
      { label: 'Start', bot: 0, real: 0 },
      { label: '01.02.', bot: 2, real: 1 },
      { label: '05.02.', bot: 1, real: 0 },
    ])
  })

  it('zählt nachgetragene Ergebnisse und uneindeutige Kerzen mit', () => {
    const ambiguousRun: BotRun = { ...run(-1, 'stop'), ambiguous: true }
    const stats = compareBotAndTrader([
      entry({ tradeId: 1, realR: 0, run: run(2), source: 'nachgetragen' }),
      entry({ tradeId: 2, realR: 0, run: ambiguousRun }),
    ])

    expect(stats.manualCount).toBe(1)
    expect(stats.ambiguousCount).toBe(1)
  })

  it('hält nicht eingegangene Trades streng von der Hauptdifferenz getrennt', () => {
    const stats = compareBotAndTrader(
      [entry({ tradeId: 1, realR: 1, run: run(2) })],
      [
        {
          tradeId: 9,
          ticker: 'NIO',
          label: '02.02.',
          run: run(3),
          source: 'kurse',
          resolution: '1day',
          hasTarget: true,
          manual: null,
        },
        {
          tradeId: 10,
          ticker: 'AI',
          label: '03.02.',
          run: { simulated: false, reason: 'nicht_ausgeloest' },
          source: 'kurse',
          resolution: '1day',
          hasTarget: true,
          manual: null,
        },
      ],
    )

    expect(stats.differenceR).toBe(-1) // 1 − 2, ohne die 3 R des Nicht-Trades
    expect(stats.missed.evaluated).toBe(1)
    expect(stats.missed.totalR).toBe(3)
    expect(stats.missed.neverTriggered).toBe(1)
    expect(stats.missed.gaps).toHaveLength(1)
  })

  it('liefert bei leerer Eingabe einen sauberen Nullzustand', () => {
    const stats = compareBotAndTrader([])
    expect(stats).toMatchObject({
      compared: 0,
      closed: 0,
      botTotalR: 0,
      realTotalR: 0,
      differenceR: 0,
      buckets: [],
      manualCount: 0,
      ambiguousCount: 0,
    })
    expect(stats.points).toEqual([{ label: 'Start', bot: 0, real: 0 }])
    expect(stats.missed.evaluated).toBe(0)
  })

  it('meldet jede verwendete Auflösung genau einmal', () => {
    const stats = compareBotAndTrader([
      entry({ tradeId: 1, run: run(1), resolution: '1h' }),
      entry({ tradeId: 2, run: run(1), resolution: '1day' }),
      entry({ tradeId: 3, run: run(1), resolution: '1h' }),
    ])
    expect(stats.resolutions).toEqual(['1h', '1day'])
  })
})

// ---------------------------------------------------------------------------
// Auflösung
// ---------------------------------------------------------------------------

describe('preferredInterval', () => {
  it('nimmt für kurze Trades feine Kerzen', () => {
    expect(preferredInterval(4)).toBe('1h')
    expect(preferredInterval(72)).toBe('1h')
  })

  it('nimmt für mittlere Haltedauern 4-Stunden-Kerzen', () => {
    expect(preferredInterval(73)).toBe('4h')
    expect(preferredInterval(24 * 30)).toBe('4h')
  })

  it('nimmt für lange Haltedauern Tageskerzen', () => {
    expect(preferredInterval(24 * 31)).toBe('1day')
    expect(preferredInterval(24 * 400)).toBe('1day')
  })

  it('fällt bei unbekannter Dauer auf die reichweitenstärkste Auflösung zurück', () => {
    expect(preferredInterval(0)).toBe('1day')
    expect(preferredInterval(Number.NaN)).toBe('1day')
    expect(preferredInterval(-5)).toBe('1day')
  })

  it('liefert nur Auflösungen, die auch zum Rückfall-Pfad gehören', () => {
    for (const span of [1, 50, 100, 1000, 100000]) {
      expect(BOT_INTERVALS).toContain(preferredInterval(span))
    }
  })

  it('ordnet die Rückfall-Kette von fein nach grob', () => {
    expect(BOT_INTERVALS).toEqual(['1h', '4h', '1day'])
  })

  it('benennt jede Auflösung auf Deutsch', () => {
    expect(intervalLabel('1h')).toBe('Stundenkerzen')
    expect(intervalLabel('1day')).toBe('Tageskerzen')
  })
})
