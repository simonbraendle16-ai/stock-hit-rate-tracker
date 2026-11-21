import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { GET, PATCH } from '@/app/api/daily-sheet/route'

const state = vi.hoisted(() => ({ user: 'first' as string | null }))
const db = new PGlite()

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: async () => state.user ? { user: { id: state.user } } : null } },
}))
vi.mock('@/lib/market-data/database', () => ({ projectBPool: () => ({
  async query(sql: string, params: unknown[]) {
    const result = await db.query(sql, params)
    return { ...result, rowCount: result.affectedRows }
  },
}) }))

beforeAll(async () => {
  await db.exec(readFileSync('drizzle-market/0003_daily_sheet.sql', 'utf8'))
})
afterAll(() => db.close())

const url = 'http://localhost/api/daily-sheet'
const read = () => GET(new NextRequest(url))
const save = (patch: object) => PATCH(new NextRequest(url, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(patch),
}))

test('isolates check-ins, merges changes, and removes the previous day', async () => {
  const { date } = await (await read()).json()
  expect((await save({ date, answers: [0, 6, 4] })).status).toBe(200)
  expect((await save({ date, states: [3, 6] })).status).toBe(200)
  expect(await (await read()).json()).toEqual({ date, answers: [0, 6, 4], states: [3, 6] })
  expect((await save({ date, states: [8] })).status).toBe(400)
  expect((await save({ date: '2000-01-01', states: [2] })).status).toBe(409)

  state.user = 'second'
  expect(await (await read()).json()).toEqual({ date, answers: [], states: [] })
  state.user = null
  expect((await read()).status).toBe(401)
  expect((await save({ date, states: [] })).status).toBe(401)

  state.user = 'first'
  await db.exec("UPDATE daily_sheet_check_in SET check_in_day = '2000-01-01'")
  expect(await (await read()).json()).toEqual({ date, answers: [], states: [] })
  expect((await db.query('SELECT user_id FROM daily_sheet_check_in')).rows).toEqual([])
})
