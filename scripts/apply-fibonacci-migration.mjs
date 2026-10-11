import { readFileSync } from 'node:fs'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
export async function migrateFibonacci(client) {
  await client.query('BEGIN')
  try {
    await client.query(
      "SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s'",
    )
    await client.query('LOCK TABLE stock,trade,portfolio IN SHARE MODE')
    const fingerprint = async () => {
      const result = {}
      for (const name of ['stock', 'trade', 'portfolio'])
        result[name] = (
          await client.query(
            `SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) hash FROM ${name} t`,
          )
        ).rows[0]
      return result
    }
    const before = await fingerprint()
    await client.query(
      readFileSync(
        new URL('../drizzle/0048_fibonacci_observations.sql', import.meta.url),
        'utf8',
      ),
    )
    for (const file of ['0049_fibonacci_research.sql','0050_fibonacci_history.sql','0051_fibonacci_two_hour.sql']) await client.query(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'))
    const after = await fingerprint()
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Historical data changed')
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='fibonacci_observation'",
    )
    if (rows[0].n !== 32) throw new Error('Incomplete Fibonacci schema')
    await client.query('COMMIT')
    return { migration: '0048-0051', historyUnchanged: true, columns: rows[0].n }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--apply'))
    console.log(
      'Dry run. Explicit FIBONACCI_MIGRATION_DATABASE_URL and --apply required.',
    )
  else {
    let client
    try {
      const url = new URL(process.env.FIBONACCI_MIGRATION_DATABASE_URL ?? '')
      if (
        url.hostname.includes('-pooler') ||
        !['postgres:', 'postgresql:'].includes(url.protocol)
      )
        throw new Error('Direct target required')
      url.searchParams.set('sslmode', 'verify-full')
      client = new pg.Client({
        connectionString: url.toString(),
        connectionTimeoutMillis: 15000,
      })
      await client.connect()
      console.log(JSON.stringify(await migrateFibonacci(client)))
    } catch (e) {
      console.error(
        `Fibonacci migration failed (${e.code ?? e.name}); secrets suppressed.`,
      )
      process.exitCode = 1
    } finally {
      await client?.end().catch(() => {})
    }
  }
}
