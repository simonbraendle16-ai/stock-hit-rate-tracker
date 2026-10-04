import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import type { trade } from './db/schema'
import type { TradeEventRow } from './trade-events'
import type { TradeTargetRow } from './trade-targets'
import type { Candle } from './market-data/types'

const state = vi.hoisted(() => ({
  brokerOrders: [] as unknown[], trades: [] as unknown[], events: [] as unknown[], targets: [] as unknown[],
  candles: [] as unknown[], kind: 'demo', fail: false, changeInstrument: false, locked: Promise.resolve(),
}))
type Predicate = { kind: string; field?: string; value?: unknown; parts?: Predicate[] }
vi.mock('drizzle-orm', async (original) => ({
  ...await original<typeof import('drizzle-orm')>(),
  eq: (column: { name: string }, value: unknown) => ({ kind: 'eq', field: column.name, value }),
  inArray: (column: { name: string }, value: unknown[]) => ({ kind: 'in', field: column.name, value }),
  and: (...parts: unknown[]) => ({ kind: 'and', parts: parts.filter(Boolean) }),
}))
vi.mock('@/lib/db', () => {
  const matches = (row: Record<string, unknown>, predicate?: Predicate): boolean => {
    if (!predicate) return true
    if (predicate.kind === 'and') return predicate.parts!.every((part) => matches(row, part))
    const value = row[predicate.field!]
    return predicate.kind === 'eq' ? value === predicate.value : (predicate.value as unknown[]).includes(value)
  }
  const rows = (table: Parameters<typeof getTableName>[0]) => {
    const name = getTableName(table)
    if (name === 'broker_order') return state.brokerOrders
    if (name === 'trade') return state.trades
    if (name === 'trade_event') return state.events
    if (name === 'trade_target') return state.targets
    if (name === 'portfolio') return [{ id: 1, userId: 'user', kind: state.kind }]
    return []
  }
  const chain = (action: (predicate?: Predicate) => unknown) => {
    let predicate: Predicate | undefined
    const query = {
      where: (value: Predicate) => { predicate = value; return query }, orderBy: () => query, limit: () => query,
      then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve().then(() => action(predicate)).then(resolve, reject),
      returning: () => query,
      catch: (reject: (error: unknown) => unknown) => Promise.resolve().then(() => action(predicate)).catch(reject),
    }
    return query
  }
  const db = {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => chain((predicate) => rows(table).filter((r) => matches(r as Record<string, unknown>, predicate)).map((r) => ({ ...(r as object) }))) }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (patch: object) => chain((predicate) => {
      for (const row of rows(table).filter((r) => matches(r as Record<string, unknown>, predicate))) Object.assign(row as object, patch)
      return []
    }) }),
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (value: object) => chain(() => {
      const list = rows(table)
      const entry = { id: list.length + 1, ...value }
      list.push(entry)
      return [entry]
    }) }),
    transaction: async (fn: (value: unknown) => Promise<unknown>) => fn(db),
  }
  return { db }
})
vi.mock('@/lib/trade-lock', () => ({
  withTradeLock: async (_user: string, _id: number, fn: (row: unknown, depot: unknown) => Promise<unknown>) => {
    const previous = state.locked
    let release!: () => void
    state.locked = new Promise<void>((resolve) => { release = resolve })
    await previous
    const saved = structuredClone({ trades: state.trades, events: state.events, targets: state.targets })
    try {
      if (state.changeInstrument) Object.assign(state.trades[0] as object, { ticker: 'OTHER', stockId: 99 })
      return await fn(state.trades[0], { kind: state.kind })
    } catch (error) {
      Object.assign(state, saved)
      throw error
    } finally { release() }
  },
}))
vi.mock('@/lib/market-data/lookup', () => ({ createSymbolResolver: async () => () => 'TEST' }))
vi.mock('@/lib/market-data/cached', () => ({
  getCachedCandles: async (_symbol: string, _market: string, _interval: string,
    options: { since?: number; limit: number; storedOnly?: boolean }) => {
    if (!options.storedOnly && state.fail) throw new Error('Provider offline')
    return (state.candles as Candle[]).filter((c) => c.time >= (options.since ?? 0)).slice(0, options.limit)
  },
}))
vi.mock('@/lib/market-data/candle-store', () => ({
  readStoredCandles: async (_symbol: string, _interval: string, options: { before?: number; since?: number; ascending?: boolean; limit: number }) => {
    const rows = (state.candles as Candle[]).filter((c) => c.time < (options.before ?? Infinity) && c.time >= (options.since ?? 0))
    return options.ascending ? rows.slice(0, options.limit) : rows.slice(-options.limit)
  },
  pruneStoredCandles: vi.fn(async () => 0),
}))
vi.mock('@/lib/portfolio-context', () => ({ loadScopedCashflows: async () => [] }))
import { repairDemoArchive, runDemoFills } from './demo-run'
import { pruneStoredCandles } from './market-data/candle-store'

const at = (time: string) => new Date(`2026-10-02T${time}:00Z`)
const candle = (time: string, patch: Partial<Candle> = {}): Candle => ({
  time: at(time).getTime() / 1000, open: 105, high: 106, low: 104, close: 105, volume: 1, ...patch,
})
const row = () => ({
  id: 1, userId: 'user', portfolioId: 1, ticker: 'TEST', market: 'aktien',
  stockId: null, status: 'aktiv', direction: 'long', entryPrice: 100, stopLoss: 95,
  takeProfit: 120, positionSize: 100, contracts: null, tradedWithMoney: false,
  createdAt: at('09:00'), openedAt: at('10:00'), demoCheckedAt: null,
  demoBoundaryAt: null, demoIssue: null, followedPlan: null, ruleViolations: null,
  feeEntry: 0, feeExit: 0,
}) as typeof trade.$inferSelect
const target = (id: number, price: number, sharePct: number): TradeTargetRow => ({
  id, userId: 'user', tradeId: 1, sortOrder: id - 1, price, sharePct,
  executedAt: null, executedPrice: null, executedQty: null, eventId: null,
  note: null, createdAt: at('09:00'),
})
const opened = (): TradeEventRow => ({
  id: 1, tradeId: 1, userId: 'user', type: 'eroeffnet', at: at('10:00'),
  quantity: 100, price: 100, fee: 0, payload: null, note: null, createdAt: at('10:00'),
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(at('12:00'))
  Object.assign(state, { brokerOrders: [], trades: [row()], events: [opened()],
    targets: [target(1, 110, 40), target(2, 120, 60)],
    candles: [candle('09:55'), candle('10:00'), candle('10:05', { high: 112 }), candle('10:10', { high: 122 })],
    kind: 'demo', fail: false, changeInstrument: false, locked: Promise.resolve() })
  vi.clearAllMocks()
})

afterEach(() => vi.useRealTimers())

describe('Demo-Ausführung mit gespeicherten Positionen', () => {
  it('kennzeichnet echte Archivbuchungen mit gröberer Zeitauflösung und wiederholt sie nicht', async () => {
    state.candles = [candle('09:45'), candle('10:00', { high: 112 }), candle('10:15', { high: 122 })]
    const result = await repairDemoArchive('user', 1, at('10:30').getTime() / 1000, false)
    expect(result.zeilen.map((z) => z.preis)).toEqual([110, 120])
    const booked = state.events.slice(1) as TradeEventRow[]
    expect(JSON.parse(booked[0].payload!)).toMatchObject({ interval: '15min', historisch: true, preisModus: 'plan' })
    expect(booked[0].note).toContain('Auslösungsfensters')
    expect((await repairDemoArchive('user', 1, at('10:30').getTime() / 1000, false)).skipped).toBe(true)
    expect(state.events).toHaveLength(3)
  })
  it('überspringt bei fehlender Positionsgröße keine möglichen Archiv-Auslöser', async () => {
    Object.assign(state.trades[0] as object, { positionSize: null })
    await expect(repairDemoArchive('user', 1, at('10:30').getTime() / 1000, false)).rejects.toThrow('Positionsgröße')
    expect(state.events).toHaveLength(1)
  })
  it('verbucht Auslöser aus einer teilweise bereits geprüften Archivkerze nicht rückwirkend', async () => {
    Object.assign(state.trades[0] as object, { demoCheckedAt: at('10:05') })
    state.candles = [candle('09:45'), candle('10:00', { high: 112 }), candle('10:15')]
    await expect(repairDemoArchive('user', 1, at('10:30').getTime() / 1000, false)).rejects.toThrow('Teilweise bereits')
    expect(state.events).toHaveLength(1)
  })
  it('verbucht keine teilweise belegte Archivhistorie', async () => {
    state.candles = [candle('09:45'), candle('10:00', { high: 112 })]
    await expect(repairDemoArchive('user', 1, at('10:30').getTime() / 1000, false)).rejects.toThrow('lückenlos')
    expect(state.events).toHaveLength(1)
  })
  it('schließt einen aktiven Alt-Trade ohne bisherige Ereignisse zu seinem Planpreis', async () => {
    state.events = []
    const result = await runDemoFills()
    expect(result.error).toBeNull()
    expect((state.trades[0] as typeof trade.$inferSelect).status).toBe('abgeschlossen')
    expect(result.zeilen.map((z) => z.preis)).toEqual([110, 120])
  })

  it('simuliert keine Ausführungen für verknüpfte Brokerpositionen', async () => {
    state.brokerOrders = [{ id: 1, userId: 'user', portfolioId: 1, linkedTradeId: 1 }]
    const result = await runDemoFills({ refresh: false })
    expect(result.zeilen).toEqual([])
    expect(state.events).toHaveLength(1)
    expect((state.trades[0] as typeof trade.$inferSelect).status).toBe('aktiv')
  })

  it('bucht mehrere Ziele chronologisch zu Planpreisen und wiederholt sie nicht', async () => {
    const result = await runDemoFills()
    expect(result).toMatchObject({ teilziele: 1, abschluesse: 1, error: null })
    expect((state.events as TradeEventRow[]).slice(1).map((e) => [e.type, e.price, e.quantity]))
      .toEqual([['teilverkauf', 110, 40], ['geschlossen', 120, 60]])
    expect((state.trades[0] as typeof trade.$inferSelect).status).toBe('abgeschlossen')
    await runDemoFills()
    expect(state.events).toHaveLength(3)
  })
  it('parallel laufende Prüfungen erzeugen nur einen Abschluss', async () => {
    state.candles = [candle('09:55'), candle('10:00', { low: 90, high: 125 })]
    await Promise.all([runDemoFills(), runDemoFills()])
    expect((state.events as TradeEventRow[]).filter((e) => e.type === 'geschlossen')).toHaveLength(1)
    expect((state.events as TradeEventRow[])[1]).toMatchObject({ price: 95, quantity: 100 })
  })
  it('berücksichtigt manuelle Verkäufe und Nachkäufe beim Rest und beim Gewinn', async () => {
    state.events.push({ ...opened(), id: 2, type: 'teilverkauf', at: at('10:00'), quantity: 30, price: 105 })
    state.events.push({ ...opened(), id: 3, type: 'nachkauf', at: at('10:00'), quantity: 50, price: 105 })
    await runDemoFills()
    expect((state.events as TradeEventRow[]).slice(3).map((e) => e.quantity)).toEqual([40, 80])
    expect(state.trades[0]).toMatchObject({ status: 'abgeschlossen', result: 'gewinn' })
  })
  it('hält nach Einstieg und Teilziel den aktiven Zustand für die nächste Kerze', async () => {
    state.trades = [{ ...row(), status: 'geplant', openedAt: null, createdAt: at('10:00') }]
    state.events = []
    state.candles = [candle('09:55'), candle('10:00', { low: 99 }),
      candle('10:05', { high: 112 }), candle('10:10', { high: 122 })]
    const result = await runDemoFills()
    expect(result).toMatchObject({ einstiege: 1, teilziele: 1, abschluesse: 1 })
    expect((state.events as TradeEventRow[]).map((e) => e.price)).toEqual([100, 110, 120])
  })
  it('ändert im Trockenlauf weder Position noch Ereignisse, Ziele oder Prüfstand', async () => {
    const before = structuredClone({ trades: state.trades, events: state.events, targets: state.targets })
    const result = await runDemoFills({ trocken: true })
    expect(result.abschluesse).toBe(1)
    expect({ trades: state.trades, events: state.events, targets: state.targets }).toEqual(before)
    expect(pruneStoredCandles).not.toHaveBeenCalled()
  })
  it('verwendet bei einem Anbieterausfall keine alten Daten und bewegt den Cursor nicht', async () => {
    state.fail = true
    const result = await runDemoFills()
    expect(result.error).toBe('Provider offline')
    expect(state.events).toHaveLength(1)
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: null, demoIssue: 'Demo-Automatik: Provider offline' })
  })
  it('weist fehlende Anfangsabdeckung aus, statt eine spätere Kerze als ursprüngliche Ausführung zu buchen', async () => {
    state.candles = [candle('11:00', { high: 125 })]
    const result = await runDemoFills()
    expect(result.unvollstaendig).toEqual([1])
    expect(state.events).toHaveLength(1)
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: null })
  })
  it('bewegt ohne Kursereignis den Cursor und liest beim nächsten Lauf nur neue Kerzen', async () => {
    state.candles = [candle('09:55'), candle('10:00')]
    await runDemoFills()
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: at('10:05') })
    state.candles.push(candle('10:05', { low: 90 }))
    await runDemoFills()
    expect((state.events as TradeEventRow[])[1]).toMatchObject({ type: 'geschlossen', price: 95 })
  })
  it('holt lange Historie seitenweise nach und bewahrt noch ungeprüfte Kerzen vor der Retention', async () => {
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    state.candles = [candle('09:55'), ...Array.from({ length: 251 }, (_, i) =>
      ({ ...candle('10:00'), time: at('10:00').getTime() / 1000 + i * 300 }))]
    const first = await runDemoFills()
    expect(first.ausstehend).toEqual([1])
    expect(pruneStoredCandles).not.toHaveBeenCalled()
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: new Date(at('10:00').getTime() + 250 * 300_000) })
    const second = await runDemoFills()
    expect(second.ausstehend).toEqual([])
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: new Date(at('10:00').getTime() + 251 * 300_000) })
    expect(state.events).toHaveLength(1)
  })
  it('stoppt vor einer Kurslücke und führt nach deren Behebung dieselbe Historie korrekt weiter', async () => {
    state.candles = [candle('09:55'), candle('10:00'), candle('10:10', { high: 125 })]
    const first = await runDemoFills()
    expect(first.unvollstaendig).toEqual([1])
    expect(state.events).toHaveLength(1)
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: at('10:05') })
    state.candles.splice(2, 0, candle('10:05', { high: 112 }))
    const second = await runDemoFills()
    expect(second).toMatchObject({ teilziele: 1, abschluesse: 1, unvollstaendig: [] })
    expect(state.events).toHaveLength(3)
  })
  it('macht frühere manuelle Planverstöße nicht nachträglich zu einem regelkonformen Trade', async () => {
    state.trades = [{ ...row(), ruleViolations: '["stop_moved"]' }]
    await runDemoFills()
    expect(state.trades[0]).toMatchObject({ followedPlan: false })
    expect(JSON.parse((state.events as TradeEventRow[])[2].payload!)).toMatchObject({ auto: true, preisModus: 'plan' })
  })
  it('verwendet nach einem gleichzeitigen Instrumentwechsel keine Kerzen des alten Symbols', async () => {
    state.changeInstrument = true
    const result = await runDemoFills()
    expect(result.ausstehend).toEqual([1])
    expect(state.events).toHaveLength(1)
    expect(state.trades[0]).toMatchObject({ ticker: 'OTHER', stockId: 99, status: 'aktiv', demoCheckedAt: null })
  })
  it('lässt Echtgeld unberührt', async () => {
    state.kind = 'echtgeld'
    await runDemoFills()
    expect(state.events).toHaveLength(1)
    expect(state.trades[0]).toMatchObject({ demoCheckedAt: null, status: 'aktiv' })
  })
})
