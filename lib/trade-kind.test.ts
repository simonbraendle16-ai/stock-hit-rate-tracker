import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRADE_KIND,
  TRADE_KINDS,
  TRADE_KIND_BADGE,
  TRADE_KIND_LABEL,
  isQuickTrade,
  normalizeTradeKind,
  requiresMoodCheck,
  requiresPreTradeGate,
} from './trade-kind'

describe('normalizeTradeKind', () => {
  it('lässt gültige Wege durch', () => {
    for (const k of TRADE_KINDS) expect(normalizeTradeKind(k)).toBe(k)
  })

  it('fällt bei Unbekanntem auf den vollen Weg zurück', () => {
    // Im Zweifel lieber ein Gate zu viel: alles Fremde wird 'langfristig'.
    for (const v of [null, undefined, '', 'quick', 'SCHNELL', 'geplant', '  schnell']) {
      expect(normalizeTradeKind(v)).toBe('langfristig')
    }
    expect(DEFAULT_TRADE_KIND).toBe('langfristig')
  })
})

describe('isQuickTrade', () => {
  it('erkennt nur den kurzen Weg', () => {
    expect(isQuickTrade('schnell')).toBe(true)
    expect(isQuickTrade('langfristig')).toBe(false)
    expect(isQuickTrade(null)).toBe(false)
  })
})

describe('Guards je Weg', () => {
  it('verlangt das Fragen-Gate nur beim langfristigen Trade', () => {
    expect(requiresPreTradeGate('langfristig')).toBe(true)
    expect(requiresPreTradeGate('schnell')).toBe(false)
  })

  it('verlangt den Emotions-Check-in nur beim langfristigen Trade', () => {
    expect(requiresMoodCheck('langfristig')).toBe(true)
    expect(requiresMoodCheck('schnell')).toBe(false)
  })

  it('greift bei Altbestand und Unfug auf die strenge Seite', () => {
    // Ein Trade ohne Feld (vor Migration 0018) muss weiterhin durchs Gate.
    expect(requiresPreTradeGate(null)).toBe(true)
    expect(requiresMoodCheck(undefined)).toBe(true)
    expect(requiresPreTradeGate('irgendwas')).toBe(true)
  })
})

describe('Beschriftungen', () => {
  it('deckt jeden Weg ab', () => {
    for (const k of TRADE_KINDS) {
      expect(TRADE_KIND_LABEL[k]).toBeTruthy()
      expect(TRADE_KIND_BADGE[k]).toBe(TRADE_KIND_BADGE[k].toUpperCase())
    }
  })
})
