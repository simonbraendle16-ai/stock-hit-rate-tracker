import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
// Standalone Node diagnostic module, exercised here with local PostgreSQL.
import { auditDatabaseEgress } from '../scripts/audit-database-egress.mjs'

let pg: PGlite
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec("CREATE TABLE private_test (id int, note text); INSERT INTO private_test VALUES (1, 'PRIVATE_CONTENT_MUST_NOT_ESCAPE')")
})
afterAll(async () => { await pg?.close() })

describe('bounded database egress audit', () => {
  it('runs actual metadata SQL read-only and treats missing extension as unavailable', async () => {
    const report = await auditDatabaseEgress(pg)
    expect(report.settings).toMatchObject({ readOnly: 'on', isolation: 'repeatable read' })
    expect(report.statistics).toEqual({ available: false, topByRows: [], topByCalls: [] })
    expect(report.tables.length).toBeLessThanOrEqual(20)
    expect(report.tables.some((row: any) => row.table === 'private_test')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CONTENT_MUST_NOT_ESCAPE')
    expect(JSON.stringify(report)).not.toContain('DATABASE_URL')
    expect((await pg.query('SELECT * FROM private_test')).rows).toHaveLength(1)
    expect((await pg.query("SELECT current_setting('transaction_read_only') AS value")).rows[0]).toEqual({ value: 'off' })
  })

  it('cleans up the transaction after a failed metadata query', async () => {
    let calls = 0
    const client = { query: async (sql: string) => {
      calls++
      if (sql.startsWith('SELECT')) throw new Error('synthetic metadata failure')
      return pg.query(sql)
    } }
    await expect(auditDatabaseEgress(client)).rejects.toThrow('synthetic metadata failure')
    expect(calls).toBe(5) // BEGIN, two local settings, failed read, ROLLBACK.
    expect((await pg.query("SELECT current_setting('transaction_read_only') AS value")).rows[0]).toEqual({ value: 'off' })
  })

  it('ranks numeric counters, scopes the role/database and never returns stored SQL text', async () => {
    // PGlite lacks the extension; its relational shape is represented locally.
    // Only capability discovery is stubbed, the diagnostic SELECTs execute in PG.
    await pg.exec(`CREATE TABLE pg_stat_statements
      (dbid oid, userid oid, queryid bigint, calls bigint, rows bigint, total_exec_time double precision, query text);
      INSERT INTO pg_stat_statements SELECT d.oid, r.oid, n, n, n*10, n,
        'SELECT note FROM trade WHERE note = ''PRIVATE_SQL_LITERAL'''
        FROM pg_database d, pg_roles r, generate_series(1,25) n
        WHERE d.datname=current_database() AND r.rolname=current_user;
      INSERT INTO pg_stat_statements VALUES (0,0,999,1000000,1000000,1,'foreign role secret');`)
    const client = { query: (sql: string) => sql.includes('EXISTS(SELECT 1 FROM pg_extension')
      ? Promise.resolve({ rows: [{ available: true }] }) : pg.query(sql) }
    const report = await auditDatabaseEgress(client)
    expect(report.statistics.available).toBe(true)
    expect(report.statistics.topByRows).toHaveLength(20)
    expect(report.statistics.topByCalls).toHaveLength(20)
    expect(report.statistics.topByRows[0]).toMatchObject({ queryId: '25', rows: '250', tableFamily: 'personal_tables' })
    expect(report.statistics.topByCalls[0]).toMatchObject({ queryId: '25', calls: '25' })
    expect(report.statistics.topByCalls.at(-1)?.calls).toBe('6')
    expect(JSON.stringify(report)).not.toContain('PRIVATE_SQL_LITERAL')
    expect(JSON.stringify(report)).not.toContain('foreign role secret')
    expect(report.statistics.topByRows.some((r: any) => r.queryId === '999')).toBe(false)
  })
})
