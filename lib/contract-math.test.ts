// Die Kontrakt-Rechnung aus `trade-math.ts` — Teil 3 des Plans „Demo-Handel".
//
// Der wichtigste Test steht unten: `contractRisk` und der bestehende
// `positionSize`-Weg müssen dieselbe Zahl liefern. Gäbe es zwei Wege zur P&L,
// gäbe es zwei Wahrheiten, und die Trefferquote hinge davon ab, welche gerade
// gelesen wird.

import { describe, expect, it } from 'vitest'
import { CONTRACT_SPECS, contractMultiplier, type ContractSpec } from './contract-specs'
import {
  contractNotional,
  contractPnl,
  contractPositionSize,
  contractRisk,
  maintenanceMarginOf,
  requiredMargin,
  ticksBetween,
} from './trade-math'

// Verengt, weil `CONTRACT_SPECS` eine Union über beide Margin-Modelle trägt —
// die Tests hier prüfen ausdrücklich je ein Modell.
const ES = CONTRACT_SPECS.ES as Extract<ContractSpec, { marginModel: 'fest' }>
const BTC = CONTRACT_SPECS.BTCPERP as Extract<ContractSpec, { marginModel: 'notional' }>

describe('ticksBetween', () => {
  it('zaehlt Ticks richtungsunabhaengig', () => {
    expect(ticksBetween(5000, 4997.5, ES.tickSize)).toBe(10)
    expect(ticksBetween(4997.5, 5000, ES.tickSize)).toBe(10)
  })

  it('bleibt bei unsinniger Eingabe bei 0 statt Unendlich', () => {
    expect(ticksBetween(5000, 4990, 0)).toBe(0)
    expect(ticksBetween(NaN, 4990, 0.25)).toBe(0)
  })
})

describe('contractRisk — der Abnahmepunkt des Plans', () => {
  it('ES, 2 Kontrakte, 10 Ticks Risiko = 250 $', () => {
    const risiko = contractRisk({ entry: 5000, stopLoss: 4997.5, contracts: 2, spec: ES })
    expect(risiko).toBeCloseTo(250, 6)
    // 2 × 10 × 12,50 — ausgeschrieben, damit der Plan im Test steht.
    expect(risiko).toBeCloseTo(2 * 10 * 12.5, 6)
  })

  it('ist deckungsgleich mit dem bestehenden positionSize-Weg', () => {
    // So rechnet der Rest der App: |Einstieg − Stop| × positionSize.
    const size = contractPositionSize(2, ES)
    expect(size).toBe(100)
    expect(Math.abs(5000 - 4997.5) * size).toBeCloseTo(
      contractRisk({ entry: 5000, stopLoss: 4997.5, contracts: 2, spec: ES }),
      6,
    )
  })

  it('gilt fuer jede Vorgabe, nicht nur fuer ES', () => {
    for (const spec of Object.values(CONTRACT_SPECS)) {
      const entry = 100
      const stop = entry - 20 * spec.tickSize
      const ueberTicks = contractRisk({ entry, stopLoss: stop, contracts: 3, spec })
      const ueberSize = Math.abs(entry - stop) * contractPositionSize(3, spec)
      expect(ueberTicks).toBeCloseTo(ueberSize, 6)
    }
  })

  it('ist 0 ohne Kontrakte', () => {
    expect(contractRisk({ entry: 5000, stopLoss: 4990, contracts: 0, spec: ES })).toBe(0)
  })
})

describe('contractPnl', () => {
  it('rechnet long richtig', () => {
    expect(contractPnl({ entry: 5000, exit: 5010, direction: 'long', contracts: 2, spec: ES }))
      .toBeCloseTo(1000, 6)
  })

  it('rechnet short mit umgekehrtem Vorzeichen', () => {
    expect(contractPnl({ entry: 5000, exit: 5010, direction: 'short', contracts: 2, spec: ES }))
      .toBeCloseTo(-1000, 6)
  })

  it('ist deckungsgleich mit (Ausstieg − Einstieg) × positionSize', () => {
    const size = contractPositionSize(2, ES)
    expect(contractPnl({ entry: 5000, exit: 5010, direction: 'long', contracts: 2, spec: ES }))
      .toBeCloseTo((5010 - 5000) * size, 6)
  })
})

describe('contractPositionSize', () => {
  it('ist Kontrakte × Multiplikator', () => {
    expect(contractPositionSize(1, ES)).toBe(contractMultiplier(ES))
    expect(contractPositionSize(3, CONTRACT_SPECS.MNQ)).toBe(6)
  })

  it('ist 0 bei negativer oder fehlender Angabe', () => {
    expect(contractPositionSize(-2, ES)).toBe(0)
    expect(contractPositionSize(NaN, ES)).toBe(0)
  })
})

describe('requiredMargin', () => {
  it('nimmt beim festen Modell den Boersenbetrag mal Anzahl', () => {
    expect(requiredMargin({ spec: ES, contracts: 2, entry: 5000 })).toBe(ES.initialMargin * 2)
  })

  it('rechnet beim Notional-Modell Kontraktwert durch Hebel', () => {
    // 1 BTC zu 60.000 mit Hebel 10 → 6.000 Einschuss.
    expect(requiredMargin({ spec: BTC, contracts: 1, entry: 60000, leverage: 10 }))
      .toBeCloseTo(6000, 6)
  })

  it('faellt beim Notional-Modell ohne Hebel auf 1 zurueck — voller Kontraktwert', () => {
    expect(requiredMargin({ spec: BTC, contracts: 1, entry: 60000 })).toBeCloseTo(60000, 6)
  })

  it('ist 0 ohne Kontrakte', () => {
    expect(requiredMargin({ spec: ES, contracts: 0, entry: 5000 })).toBe(0)
  })
})

describe('maintenanceMarginOf', () => {
  it('nimmt beim festen Modell den Haltebetrag, nicht den Anfangsbetrag', () => {
    expect(maintenanceMarginOf({ spec: ES, contracts: 2, entry: 5000 }))
      .toBe(ES.maintenanceMargin * 2)
    expect(maintenanceMarginOf({ spec: ES, contracts: 2, entry: 5000 }))
      .toBeLessThan(requiredMargin({ spec: ES, contracts: 2, entry: 5000 }))
  })

  it('rechnet beim Notional-Modell den Anteil des Kontraktwerts', () => {
    expect(maintenanceMarginOf({ spec: BTC, contracts: 1, entry: 60000 }))
      .toBeCloseTo(60000 * BTC.maintenanceRate, 6)
  })
})

describe('contractNotional', () => {
  it('ist Kurs × Kontraktgroesse × Kontrakte — 1 ES zu 5.000 sind 250.000 $', () => {
    expect(contractNotional({ entry: 5000, contracts: 1, contractSize: ES.contractSize }))
      .toBe(250000)
  })
})
