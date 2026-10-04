import { describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  let next = 0
  const connection = (name: string) => ({
    execute: async () => name,
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(connection(`${name}/${++next}`)),
  })
  return { database: connection('pool') }
})
vi.mock('pg', () => ({ Pool: class { options = { max: 4 } } }))
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: () => fake.database }))
import { db, inDatabaseTransaction } from './index'
import { sql } from 'drizzle-orm'

describe('Transaktionskontext für manuelle und automatische Buchungen', () => {
  it('leitet Helfer und verschachtelte Transaktionen auf dieselbe Verbindung weiter', async () => {
    const parent = await inDatabaseTransaction(async () => {
      const first = await db.execute(sql`select 1`)
      const child = await db.transaction(async () => db.execute(sql`select 1`))
      const restored = await db.execute(sql`select 1`)
      expect(String(child).startsWith(`${first}/`)).toBe(true)
      expect(restored).toBe(first)
      return first
    })
    expect(parent).not.toBe('pool')
    expect(await db.execute(sql`select 1`)).toBe('pool')
  })
  it('isoliert gleichzeitig laufende Transaktionen voneinander', async () => {
    const values = await Promise.all([1, 2].map(() => inDatabaseTransaction(async () => {
      const before = await db.execute(sql`select 1`)
      await Promise.resolve()
      expect(await db.execute(sql`select 1`)).toBe(before)
      return before
    })))
    expect(values[0]).not.toBe(values[1])
  })
  it('reserviert Pool-Verbindungen für Auth-Abfragen, statt alle durch wartende Trade-Sperren zu belegen', async () => {
    let active = 0
    let maximum = 0
    await Promise.all(Array.from({ length: 8 }, () => inDatabaseTransaction(async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active--
    })))
    expect(maximum).toBe(2)
    expect(active).toBe(0)
  })
  it('stellt nach einem Fehler den normalen Datenbankzugriff wieder her', async () => {
    await expect(inDatabaseTransaction(async () => { throw new Error('abbruch') })).rejects.toThrow('abbruch')
    expect(await db.execute(sql`select 1`)).toBe('pool')
  })
})
