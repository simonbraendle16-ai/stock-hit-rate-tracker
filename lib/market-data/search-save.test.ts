// Serveraktionen mit simuliertem DB-/Provider-Rand; keine echten Einträge.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addStockFromSearch } from '@/app/actions/symbols'
import { addStock } from '@/app/actions/stocks'

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  quotes: vi.fn(), sync: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'test-user' } }) } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/market-data/yahoo', () => ({ getYahooQuotes: state.quotes, searchYahoo: vi.fn() }))
vi.mock('@/lib/market-data/sync', () => ({ runSymbolSync: state.sync, refreshQuotesIfStale: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => Object.assign([{ id: 42 }], { limit: async () => [] }) }) }),
  insert: () => ({ values: (values: Record<string, unknown>) => {
    state.inserted.push(values)
    return { returning: async () => [{ id: 42 }] }
  } }),
  update: () => ({ set: (values: Record<string, unknown>) => {
    state.updated.push(values)
    return { where: () => Object.assign(Promise.resolve([]), { returning: async () => [] }) }
  } }),
} }))

beforeEach(() => {
  state.inserted.length = 0
  state.updated.length = 0
  state.quotes.mockReset()
  state.sync.mockReset().mockResolvedValue({})
})

describe('Suchauswahl speichern trotz fehlender Kursbestätigung', () => {
  it.each(['Ausfall', 'kein Kurs'])('bewahrt die Auswahl bei %s und vermeidet eine automatische Ersatzzuordnung', async (failure) => {
    if (failure === 'Ausfall') state.quotes.mockRejectedValue(new Error('Simulierter Anbieterausfall'))
    else state.quotes.mockResolvedValue(new Map())
    const result = await addStockFromSearch({ symbol: ' exm.l ', name: 'Example', quoteType: 'EQUITY' })
    expect(result.id).toBe(42)
    expect(result.hinweis).toBeTruthy()
    expect(state.inserted[0]).toMatchObject({ providerSymbol: 'EXM.L', resolutionPinned: true, resolutionStatus: 'unresolved' })
    expect(state.updated.some(v => v.resolutionStatus === 'ok')).toBe(false)
    expect(state.sync).not.toHaveBeenCalled()
  })

  it('bestätigt die gewählte Notierung und holt anschließend nur Kurse', async () => {
    state.quotes.mockResolvedValue(new Map([['EXM.L', { symbol: 'EXM.L', price: 10, currency: 'GBP', name: 'Example', exchange: 'LSE' }]]))
    const result = await addStockFromSearch({ symbol: 'EXM.L', name: 'Example', quoteType: 'EQUITY' })
    expect(result.hinweis).toBeNull()
    expect(state.updated).toContainEqual(expect.objectContaining({ providerSymbol: 'EXM.L', resolutionStatus: 'ok', resolutionPinned: true }))
    expect(state.sync).toHaveBeenCalledExactlyOnceWith({ trigger: 'manual', onlyStockIds: [42], maxResolves: 0 })
  })

  it('behält den normalen Auflösungsweg für frei eingegebene Instrumente', async () => {
    await addStock({ ticker: 'EXM', name: 'Example' })
    expect(state.sync).toHaveBeenCalledExactlyOnceWith({ trigger: 'manual', onlyStockIds: [42], forceResolve: true })
  })

  it('lehnt ungültige Suchsymbole vor dem ersten Schreibzugriff ab', async () => {
    await expect(addStockFromSearch({ symbol: 'EXM/invalid', name: 'Example', quoteType: 'EQUITY' })).rejects.toThrow('Ungültiges Symbol')
    expect(state.inserted).toHaveLength(0)
  })
})
