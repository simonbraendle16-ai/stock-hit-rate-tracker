// Explicit target only. This script never loads .env or changes observation values.
import pg from 'pg'
import { readFileSync } from 'node:fs'
const target = process.env.FIBONACCI_MIGRATION_DATABASE_URL
if (!process.argv.includes('--apply') || !target) {
 console.log('Dry run. Explicit FIBONACCI_MIGRATION_DATABASE_URL and --apply required.')
 process.exit(0)
}
let client
try {
 const url = new URL(target)
 if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.includes('-pooler')) throw new Error('Direct target required')
 url.searchParams.set('sslmode','verify-full')
 client = new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000})
 await client.connect()
 await client.query('BEGIN')
 await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'")
 await client.query('LOCK TABLE fibonacci_observation IN ACCESS EXCLUSIVE MODE')
 const snapshot = async () => {
  const values = {}
  for (const table of ['stock','trade','portfolio','fibonacci_observation','fibonacci_revision','fibonacci_history'])
   values[table] = (await client.query(`SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) hash FROM ${table} t`)).rows[0]
  return JSON.stringify(values)
 }
 const before=await snapshot()
 const sql=readFileSync(new URL('../drizzle/0051_fibonacci_two_hour.sql',import.meta.url),'utf8')
 await client.query(sql)
 if (process.argv.includes('--twice')) await client.query(sql)
 if (before!==await snapshot()) throw new Error('Existing data changed; rolling back')
 const constraint=(await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='fibonacci_observation'::regclass AND conname='fib_timeframe'")).rows[0]?.definition
 if (!constraint?.includes("'2h'")) throw new Error('Two-hour constraint missing')
 await client.query('COMMIT')
 console.log(JSON.stringify({migration:'0051',existingValuesUnchanged:true,twoHourAllowed:true,appliedTwice:process.argv.includes('--twice')}))
} catch (e) {
 await client?.query('ROLLBACK').catch(()=>{})
 console.error(JSON.stringify({migration:'0051',failed:true,code:e.code??e.name,secretsSuppressed:true}))
 process.exitCode=1
} finally {await client?.end().catch(()=>{})}