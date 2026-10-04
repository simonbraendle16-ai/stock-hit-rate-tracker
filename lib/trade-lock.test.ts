import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
const fake = vi.hoisted(() => ({
  log: [] as string[], predicates: [] as unknown[], owned: true, moved: false,
}))
vi.mock('@/lib/db', () => ({
  inDatabaseTransaction: async (fn: () => Promise<unknown>) => fn(),
  db: { select: (fields?: object) => ({ from: (table: Parameters<typeof getTableName>[0]) => {
    const name = getTableName(table)
    const rows = () => name === 'portfolio' ? [{ id: 4, userId: 'user', kind: 'demo' }]
      : fake.owned ? [{ id: 1, userId: 'user', portfolioId: !fields && fake.moved ? 5 : 4 }] : []
    const query = {
      where: (predicate: unknown) => { fake.predicates.push(predicate); return query },
      for: async (mode: string) => { fake.log.push(`${name}:${mode}`); return rows() },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows()).then(resolve),
    }
    return query
  } }) },
}))
import { withTradeLock } from './trade-lock'
beforeEach(() => { fake.log = []; fake.predicates = []; fake.owned = true; fake.moved = false })
describe('Gemeinsame Depot-/Trade-Sperre', () => {
  it('sperrt zuerst das Depot, dann den aktuellen Trade und prüft überall den Besitzer', async () => {
    await withTradeLock('user', 1, async () => { fake.log.push('callback'); return 1 })
    expect(fake.log).toEqual(['portfolio:update', 'trade:update', 'callback'])
    const dialect = new PgDialect()
    expect(fake.predicates.map((p) => dialect.sqlToQuery(p as Parameters<typeof dialect.sqlToQuery>[0]).params))
      .toEqual([[1, 'user'], [4, 'user'], [1, 'user']])
  })
  it('ruft für einen fremden/nicht vorhandenen Trade den Buchungscode nicht auf', async () => {
    fake.owned = false
    const callback = vi.fn()
    await expect(withTradeLock('stranger', 1, callback)).rejects.toThrow('Diesen Trade')
    expect(callback).not.toHaveBeenCalled()
    expect(fake.log).toEqual([])
  })
  it('übernimmt keinen inzwischen in ein anderes Depot verschobenen Trade', async () => {
    fake.moved = true
    const callback = vi.fn()
    await expect(withTradeLock('user', 1, callback)).rejects.toThrow('inzwischen geändert')
    expect(callback).not.toHaveBeenCalled()
  })
})
