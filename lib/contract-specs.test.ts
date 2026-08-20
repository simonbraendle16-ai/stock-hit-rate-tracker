import { describe, expect, it } from 'vitest'
import {
  CONTRACT_SPECS,
  contractMultiplier,
  kontraktWurzel,
  lookupContractSpec,
  mergeContractSpec,
  resolveContractSpec,
} from './contract-specs'

describe('kontraktWurzel', () => {
  it('erkennt die TradingView-Fortlaufkennung', () => {
    expect(kontraktWurzel('ES1!')).toBe('ES')
    expect(kontraktWurzel('MCL2!')).toBe('MCL')
  })

  it('erkennt die Yahoo-Schreibweise', () => {
    expect(kontraktWurzel('ES=F')).toBe('ES')
    expect(kontraktWurzel('gc=f')).toBe('GC')
  })

  it('erkennt einen bestimmten Liefermonat', () => {
    expect(kontraktWurzel('ESZ5')).toBe('ES')
    expect(kontraktWurzel('ESZ2025')).toBe('ES')
    expect(kontraktWurzel('SIU5')).toBe('SI')
  })

  it('nimmt eine blanke Wurzel NUR als Rohstoff — sonst waere SI eine Aktie', () => {
    expect(kontraktWurzel('SI', 'aktien')).toBeNull()
    expect(kontraktWurzel('SI')).toBeNull()
    expect(kontraktWurzel('SI', 'rohstoffe')).toBe('SI')
    expect(kontraktWurzel('GC', 'rohstoffe')).toBe('GC')
  })

  it('laesst blankes ETHUSD Spot bleiben — ein Altbestand wird nie stillschweigend zum Kontrakt', () => {
    expect(kontraktWurzel('ETHUSD', 'krypto')).toBeNull()
    expect(kontraktWurzel('BTCUSD', 'krypto')).toBeNull()
  })

  it('erkennt Perpetuals nur mit Kennung', () => {
    expect(kontraktWurzel('BTCUSDT.P', 'krypto')).toBe('BTCPERP')
    expect(kontraktWurzel('BTCPERP', 'krypto')).toBe('BTCPERP')
    expect(kontraktWurzel('ETHUSD-PERP', 'krypto')).toBe('ETHPERP')
  })

  it('gibt null fuer Unbekanntes', () => {
    expect(kontraktWurzel('AAPL', 'aktien')).toBeNull()
    expect(kontraktWurzel('XY1!', 'aktien')).toBeNull()
    expect(kontraktWurzel('')).toBeNull()
  })
})

describe('contractMultiplier', () => {
  it('ist Tick-Wert je Tick-Groesse — bei ES 50', () => {
    expect(contractMultiplier(CONTRACT_SPECS.ES)).toBe(50)
    expect(contractMultiplier(CONTRACT_SPECS.MES)).toBe(5)
    expect(contractMultiplier(CONTRACT_SPECS.NQ)).toBe(20)
  })

  it('stimmt bei jeder Vorgabe mit der hinterlegten Kontraktgroesse ueberein', () => {
    for (const spec of Object.values(CONTRACT_SPECS)) {
      expect(contractMultiplier(spec)).toBeCloseTo(spec.contractSize, 6)
    }
  })
})

describe('mergeContractSpec', () => {
  it('nimmt die Vorgabe, wenn nichts von Hand steht', () => {
    expect(mergeContractSpec(CONTRACT_SPECS.ES)).toEqual(CONTRACT_SPECS.ES)
  })

  it('laesst die Handeingabe feldweise gewinnen', () => {
    const s = mergeContractSpec(CONTRACT_SPECS.ES, { initialMargin: 15000 })
    expect(s?.marginModel).toBe('fest')
    expect(s?.marginModel === 'fest' && s.initialMargin).toBe(15000)
    // Der Rest bleibt die Vorgabe.
    expect(s?.tickSize).toBe(0.25)
    expect(s?.tickValue).toBe(12.5)
  })

  it('gibt null, wenn der Nutzer Kontrakte fuer dieses Instrument abgeschaltet hat', () => {
    expect(mergeContractSpec(CONTRACT_SPECS.ES, { disabled: true })).toBeNull()
  })

  it('gibt null bei halber Angabe — ein halb bekannter Kontrakt ist keiner', () => {
    expect(mergeContractSpec(null, { tickSize: 0.25 })).toBeNull()
    expect(mergeContractSpec(null, { tickSize: 0.25, tickValue: 12.5 })).toBeNull()
  })

  it('baut eine reine Handeingabe ohne Vorgabe', () => {
    const s = mergeContractSpec(null, {
      tickSize: 0.5,
      tickValue: 5,
      contractSize: 10,
      currency: 'eur',
      initialMargin: 2000,
    })
    expect(s).not.toBeNull()
    expect(s?.currency).toBe('EUR')
    expect(contractMultiplier(s!)).toBe(10)
    expect(s?.marginModel === 'fest' && s.maintenanceMargin).toBe(2000)
  })

  it('verlangt beim Notional-Modell einen Erhaltungssatz', () => {
    expect(
      mergeContractSpec(null, {
        tickSize: 0.1,
        tickValue: 0.1,
        contractSize: 1,
        currency: 'USD',
        marginModel: 'notional',
      }),
    ).toBeNull()
  })

  it('ignoriert unsinnige Handwerte statt sie zu uebernehmen', () => {
    const s = mergeContractSpec(CONTRACT_SPECS.ES, { tickSize: 0, tickValue: -3 })
    expect(s?.tickSize).toBe(0.25)
    expect(s?.tickValue).toBe(12.5)
  })
})

describe('resolveContractSpec', () => {
  it('loest ueber die Wurzel auf', () => {
    expect(resolveContractSpec({ ticker: 'ES1!' })?.root).toBe('ES')
  })

  it('bleibt null fuer eine gewoehnliche Aktie', () => {
    expect(resolveContractSpec({ ticker: 'AAPL', market: 'aktien' })).toBeNull()
  })

  it('nimmt die Handeingabe auch ohne erkannte Wurzel', () => {
    const s = resolveContractSpec({
      ticker: 'FDAX',
      market: 'sonstiges',
      hand: {
        tickSize: 1,
        tickValue: 25,
        contractSize: 25,
        currency: 'EUR',
        initialMargin: 30000,
      },
    })
    expect(s?.currency).toBe('EUR')
    expect(contractMultiplier(s!)).toBe(25)
  })
})

describe('lookupContractSpec', () => {
  it('haelt Wurzel und Schluessel deckungsgleich', () => {
    for (const [key, spec] of Object.entries(CONTRACT_SPECS)) expect(spec.root).toBe(key)
  })

  it('liefert die ES-Vorgabe mit 12,50 $ je Tick', () => {
    const s = lookupContractSpec('ES1!')
    expect(s?.tickValue).toBe(12.5)
    expect(s?.tickSize).toBe(0.25)
  })
})
