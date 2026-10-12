import { describe, expect, it } from 'vitest'
import { demoSourceIssue } from './demo-source'

const exact = { providerSymbol: 'META', resolutionStatus: 'ok', resolutionApproximate: false, market: 'aktien' }
describe('Kursquelle für Demo-Ausführung', () => {
  it('erlaubt die bestätigte exakte Zuordnung', () => expect(demoSourceIssue(exact, 'aktien')).toBeNull())
  it('sperrt Futures als Spotersatz', () => expect(demoSourceIssue({ ...exact, providerSymbol: 'GC=F', market: 'rohstoffe', resolutionApproximate: true }, 'rohstoffe')).toContain('Näherung'))
  it('erlaubt einen ausdrücklich gehandelten Future', () => expect(demoSourceIssue({ ...exact, providerSymbol: 'CL=F', market: 'rohstoffe' }, 'rohstoffe')).toBeNull())
  it('erkennt den Gold-Future auch bei fehlerhaft fehlendem Näherungsflag', () => expect(demoSourceIssue({ ...exact, providerSymbol: 'GC=F', market: 'rohstoffe' }, 'rohstoffe', 'XAUUSD')).toContain('Näherung'))
  it('sperrt fehlende und unbestätigte Zuordnungen', () => {
    expect(demoSourceIssue(null, 'aktien')).toContain('unbestätigt')
    expect(demoSourceIssue({ ...exact, resolutionStatus: 'unresolved' }, 'aktien')).toContain('unbestätigt')
  })
  it('sperrt widersprüchliche Anlageklassen', () => expect(demoSourceIssue(exact, 'krypto')).toContain('Anlageklasse'))
})
