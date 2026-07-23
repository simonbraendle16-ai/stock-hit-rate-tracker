import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORDER_FEE,
  computePositionValue,
  computeRiskReward,
  computeShares,
  projectStopLoss,
  projectTakeProfit,
} from './trade-math'

describe('computeShares', () => {
  it('leitet die Stückzahl aus Einsatz und Einstieg ab', () => {
    expect(computeShares(1000, 50)).toBe(20)
  })

  it('erlaubt fraktionale Stückzahlen (Krypto)', () => {
    expect(computeShares(1000, 30000)).toBeCloseTo(0.0333333, 6)
  })

  it('vervielfacht die Position mit dem Hebel', () => {
    expect(computeShares(1000, 50, 5)).toBe(100)
  })

  it('behandelt fehlenden oder unsinnigen Hebel als ungehebelt', () => {
    expect(computeShares(1000, 50, 0)).toBe(20)
    expect(computeShares(1000, 50, -3)).toBe(20)
    expect(computeShares(1000, 50, Number.NaN)).toBe(20)
  })

  it('liefert 0 statt Unendlich bei ungültigen Eingaben', () => {
    expect(computeShares(0, 50)).toBe(0)
    expect(computeShares(1000, 0)).toBe(0)
    expect(computeShares(1000, -5)).toBe(0)
  })
})

describe('computePositionValue', () => {
  it('trennt Positionswert vom gebundenen Kapital', () => {
    // 1.000 € Einsatz bei Hebel 5 hält eine Position über 5.000 €.
    expect(computePositionValue(1000, 5)).toBe(5000)
    expect(computePositionValue(1000)).toBe(1000)
  })
})

describe('computeRiskReward', () => {
  it('rechnet richtungsunabhängig', () => {
    expect(computeRiskReward(100, 90, 130)).toBe(3) // long
    expect(computeRiskReward(100, 110, 70)).toBe(3) // short
  })

  it('liefert null ohne Take-Profit', () => {
    expect(computeRiskReward(100, 90, null)).toBeNull()
  })

  it('liefert null statt Unendlich, wenn Stop auf dem Einstieg liegt', () => {
    expect(computeRiskReward(100, 100, 130)).toBeNull()
  })
})

describe('projectTakeProfit', () => {
  const base = { invested: 1000, entry: 100, tp: 120, direction: 'long' as const, sellPct: 100 }

  it('rechnet Gewinn nach Gebühren', () => {
    const p = projectTakeProfit(base)!
    expect(p.shares).toBe(10)
    expect(p.grossProfit).toBe(200)
    expect(p.fees).toBe(DEFAULT_ORDER_FEE * 2)
    expect(p.netProfit).toBe(200 - 18)
  })

  it('nutzt die übergebenen Gebühren statt der Vorgabe', () => {
    const p = projectTakeProfit({ ...base, fees: { entry: 1, exit: 0.5 } })!
    expect(p.fees).toBe(1.5)
    expect(p.netProfit).toBe(198.5)
  })

  it('akzeptiert gebührenfreie Broker (0 ist kein fehlender Wert)', () => {
    const p = projectTakeProfit({ ...base, fees: { entry: 0, exit: 0 } })!
    expect(p.fees).toBe(0)
    expect(p.netProfit).toBe(200)
  })

  it('berücksichtigt den Hebel in der Positionsgröße', () => {
    const p = projectTakeProfit({ ...base, leverage: 3 })!
    expect(p.shares).toBe(30)
    expect(p.grossProfit).toBe(600)
  })

  it('teilt beim Teilverkauf korrekt auf', () => {
    const p = projectTakeProfit({ ...base, sellPct: 40 })!
    expect(p.soldShares).toBeCloseTo(4)
    expect(p.remainingShares).toBeCloseTo(6)
    expect(p.grossProfit).toBeCloseTo(80)
  })

  it('rechnet Short in die richtige Richtung', () => {
    const p = projectTakeProfit({ ...base, direction: 'short', tp: 80 })!
    expect(p.grossProfit).toBe(200)
  })

  it('begrenzt den Verkaufsanteil auf 0..100', () => {
    expect(projectTakeProfit({ ...base, sellPct: 150 })!.soldShares).toBe(10)
    expect(projectTakeProfit({ ...base, sellPct: -20 })!.soldShares).toBe(0)
  })

  it('liefert null ohne Einsatz oder Kurs', () => {
    expect(projectTakeProfit({ ...base, invested: 0 })).toBeNull()
    expect(projectTakeProfit({ ...base, tp: 0 })).toBeNull()
  })
})

describe('projectStopLoss', () => {
  const base = { invested: 1000, entry: 100, sl: 90, direction: 'long' as const }

  it('rechnet den Verlust negativ, inklusive Gebühren', () => {
    const p = projectStopLoss(base)!
    expect(p.shares).toBe(10)
    expect(p.grossLoss).toBe(-100)
    expect(p.netLoss).toBe(-118)
  })

  it('rechnet Short in die richtige Richtung', () => {
    const p = projectStopLoss({ ...base, direction: 'short', sl: 110 })!
    expect(p.grossLoss).toBe(-100)
  })

  it('vergrößert den Verlust mit dem Hebel', () => {
    const p = projectStopLoss({ ...base, leverage: 4 })!
    expect(p.grossLoss).toBe(-400)
  })
})
