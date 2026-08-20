import { describe, expect, it } from 'vitest'
import { CONTRACT_SPECS } from './contract-specs'
import {
  contractTradeFelder,
  deckungAus,
  einschussInKontowaehrung,
  gebundeneMargin,
  specFromStock,
} from './contract-trade'

const ES = CONTRACT_SPECS.ES

describe('specFromStock', () => {
  it('findet die Vorgabe ueber die Kontrakt-Wurzel des Tickers', () => {
    expect(specFromStock({ ticker: 'ES1!', market: 'sonstiges' })?.root).toBe('ES')
  })

  it('laesst die Handeingabe am Instrument gewinnen', () => {
    const s = specFromStock({
      ticker: 'ES1!',
      market: 'sonstiges',
      contractInitialMargin: 16000,
    })
    expect(s?.marginModel === 'fest' && s.initialMargin).toBe(16000)
    expect(s?.tickValue).toBe(12.5)
  })

  it('respektiert den Abschalter', () => {
    expect(specFromStock({ ticker: 'ES1!', contractsDisabled: true })).toBeNull()
  })

  it('bleibt null fuer eine gewoehnliche Aktie', () => {
    expect(specFromStock({ ticker: 'AAPL', market: 'aktien' })).toBeNull()
    expect(specFromStock(null)).toBeNull()
  })
})

describe('contractTradeFelder — der Abnahmepunkt des Plans', () => {
  it('ES, 2 Kontrakte, 10 Ticks Risiko: 250 $ Risiko, positionSize 100', () => {
    const f = contractTradeFelder({
      spec: ES,
      contracts: 2,
      entryPrice: 5000,
      stopLoss: 4997.5,
    })
    expect(f).not.toBeNull()
    expect(f!.risiko).toBeCloseTo(250, 6)
    expect(f!.positionSize).toBe(100)
    expect(f!.contractMultiplier).toBe(50)
    expect(f!.contractCurrency).toBe('USD')
  })

  it('friert Tick-Groesse und Tick-Wert ein', () => {
    const f = contractTradeFelder({ spec: ES, contracts: 1, entryPrice: 5000, stopLoss: 4990 })
    expect(f!.contractTickSize).toBe(0.25)
    expect(f!.contractTickValue).toBe(12.5)
  })

  it('traegt den Einschuss aller Kontrakte', () => {
    const f = contractTradeFelder({ spec: ES, contracts: 3, entryPrice: 5000, stopLoss: 4990 })
    expect(f!.contractInitialMargin).toBe(
      (ES.marginModel === 'fest' ? ES.initialMargin : 0) * 3,
    )
  })

  it('ist null ohne Kontrakte — kein Kontrakt-Trade aus Versehen', () => {
    expect(contractTradeFelder({ spec: ES, contracts: 0, entryPrice: 5000, stopLoss: 4990 }))
      .toBeNull()
    expect(contractTradeFelder({ spec: ES, contracts: -1, entryPrice: 5000, stopLoss: 4990 }))
      .toBeNull()
  })
})

describe('gebundeneMargin', () => {
  it('zaehlt geplante UND aktive Kontrakt-Trades — der Plan steht vor dem Einstieg fest', () => {
    expect(
      gebundeneMargin([
        { status: 'geplant', investedAmount: 5000, contracts: 1 },
        { status: 'aktiv', investedAmount: 3000, contracts: 2 },
      ]),
    ).toBe(8000)
  })

  it('zaehlt NUR Kontrakt-Trades — eine Aktienposition ist kein Einschuss', () => {
    // Der Fall aus der Praxis: zehn gewoehnliche Demo-Trades a 300 EUR
    // Papier-Einsatz. Wuerden sie mitzaehlen, waeren 3.000 EUR „gebundener
    // Einschuss", obwohl kein einziger Einschuss existiert — und die
    // Kontrakt-Deckung waere um genau diesen Betrag zu klein.
    const aktien = Array.from({ length: 10 }, () => ({
      status: 'aktiv',
      investedAmount: 300,
      contracts: null,
    }))
    expect(gebundeneMargin(aktien)).toBe(0)
    expect(gebundeneMargin([...aktien, { status: 'aktiv', investedAmount: 12420, contracts: 1 }]))
      .toBe(12420)
  })

  it('laesst abgeschlossene und abgebrochene Trades draussen', () => {
    expect(
      gebundeneMargin([
        { status: 'abgeschlossen', investedAmount: 5000, contracts: 1 },
        { status: 'abgebrochen', investedAmount: 5000, contracts: 1 },
        { status: 'kein_handel', investedAmount: 5000, contracts: 1 },
      ]),
    ).toBe(0)
  })

  it('uebergeht Zeilen ohne verwertbaren Betrag statt sie zu erfinden', () => {
    expect(
      gebundeneMargin([
        { status: 'aktiv', investedAmount: null, contracts: 1 },
        { status: 'aktiv', investedAmount: NaN, contracts: 1 },
        { status: 'aktiv', investedAmount: -100, contracts: 1 },
        { status: 'aktiv', investedAmount: 200, contracts: 1 },
      ]),
    ).toBe(200)
  })

  it('uebergeht Zeilen mit unsinniger Kontraktzahl', () => {
    expect(
      gebundeneMargin([
        { status: 'aktiv', investedAmount: 500, contracts: 0 },
        { status: 'aktiv', investedAmount: 500, contracts: -1 },
        { status: 'aktiv', investedAmount: 500, contracts: NaN },
      ]),
    ).toBe(0)
  })
})

describe('deckungAus', () => {
  it('setzt Kontostand und Bindung zusammen', () => {
    const d = deckungAus({
      startCapital: 30000,
      netCashflow: 0,
      realisiertePnl: -5000,
      offeneTrades: [{ status: 'aktiv', investedAmount: 12420, contracts: 1 }],
    })
    expect(d.kontostand).toBe(25000)
    expect(d.gebundeneMargin).toBe(12420)
    expect(d.frei).toBe(12580)
  })
})

describe('einschussInKontowaehrung', () => {
  it('rechnet mit dem gepflegten Kurs', () => {
    expect(
      einschussInKontowaehrung({
        einschuss: 13500,
        waehrung: 'USD',
        kontowaehrung: 'EUR',
        rates: { USD: 0.92 },
      }),
    ).toBeCloseTo(12420, 6)
  })

  it('ist null statt 1:1, wenn kein Kurs hinterlegt ist', () => {
    expect(
      einschussInKontowaehrung({
        einschuss: 13500,
        waehrung: 'USD',
        kontowaehrung: 'EUR',
        rates: {},
      }),
    ).toBeNull()
  })
})
