import pg from 'pg'
pg.types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'))
const anchor = Number(process.argv[2])
if (!Number.isSafeInteger(anchor) || anchor <= 0) throw new Error('Eindeutiger Anker-Trade erforderlich.')
console.log(JSON.stringify({ configuration: Object.fromEntries(['DATABASE_URL','ASSISTANT_API_BASE_URL','ASSISTANT_API_TOKEN','ALERT_CRON_SECRET','CRONJOB_API_KEY'].map(key => [key, !!process.env[key]])) }))
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, statement_timeout: 10000 })
try {
  await client.connect(); await client.query('BEGIN READ ONLY')
  const owner = await client.query('SELECT "userId" FROM trade WHERE id=$1', [anchor])
  if (owner.rowCount !== 1) throw new Error('Anker nicht eindeutig.')
  const portfolios = await client.query(`SELECT id,kind,currency,"fxRatesAt",COALESCE("fxRates",'{}')::jsonb ? 'EUR' AS "eurRatePresent",
    COALESCE("fxRates",'{}')::jsonb ? 'USD' AS "usdRatePresent" FROM portfolio WHERE "userId"=$1`, [owner.rows[0].userId])
  const runs = await client.query('SELECT id,"startedAt","finishedAt",trigger,"alertsOpen",triggered,"mailsSent","mailsFailed",error FROM alert_check_run ORDER BY "startedAt" DESC LIMIT 4')
  console.log(JSON.stringify({ readOnly: true, at: new Date().toISOString(), portfolios: portfolios.rows,
    checks: runs.rows.map(({ error, ...r }) => ({ ...r, errorPresent: !!error })) }, null, 2))
} catch {
  console.error('Lesenachweis nicht möglich; keine Zugangsdaten oder rohe Datenbankfehler ausgegeben.'); process.exitCode = 1
} finally { await client.query('ROLLBACK').catch(() => {}); await client.end() }
