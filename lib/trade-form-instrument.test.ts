import { describe, expect, it, vi } from 'vitest'
import { lookupContractSpec } from './contract-specs'
import { resolveTradeFormInstrument } from './trade-form-instrument'

describe('trade form instrument resolution', () => {
  it('resolves ES1! even when the optional external resolver never finishes', async () => {
    const external = vi.fn(() => new Promise<string | null>(() => {}))
    const spec = lookupContractSpec('ES1!', 'rohstoffe')
    const result = await resolveTradeFormInstrument(async () => spec, external)
    expect(result.spec?.root).toBe('ES')
    expect(result.currency).toBe('USD')
    expect(external).not.toHaveBeenCalled()
  })
  it('keeps explicit contract disablement and resolves only the instrument currency', async () => {
    expect(await resolveTradeFormInstrument(async () => null, async () => 'EUR'))
      .toEqual({ spec: null, currency: 'EUR' })
  })
  it('keeps unknown currency unknown for an ordinary instrument', async () => {
    expect(await resolveTradeFormInstrument(async () => null, async () => null))
      .toEqual({ spec: null, currency: null })
  })
  it('does not turn a failed contract lookup into a normal stock result', async () => {
    const external = vi.fn(async () => 'USD')
    await expect(resolveTradeFormInstrument(async () => { throw new Error('db unavailable') }, external))
      .rejects.toThrow('db unavailable')
    expect(external).not.toHaveBeenCalled()
  })
  it('propagates currency lookup failure instead of declaring a resolved instrument', async () => {
    await expect(resolveTradeFormInstrument(async () => null, async () => { throw new Error('unavailable') }))
      .rejects.toThrow('unavailable')
  })
})
