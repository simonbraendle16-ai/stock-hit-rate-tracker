// Local-only synthetic QA: no .env file is read and no cloud database is used.
// Install test tools: npm install --prefix .test-tools --no-save --package-lock=false @electric-sql/pglite-socket@0.2.11 @electric-sql/pglite@0.5.8
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../.test-tools/node_modules/@electric-sql/pglite-socket/dist/index.js'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import * as schema from '../lib/db/schema.ts'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { hashPassword } from 'better-auth/crypto'
import { randomUUID } from 'node:crypto'
import { migrateFibonacci } from './apply-fibonacci-migration.mjs'
const qaPort = Number(process.env.FIBONACCI_QA_PORT ?? 3018), qaDbPort = Number(process.env.FIBONACCI_QA_DB_PORT ?? 5548);
if (![qaPort,qaDbPort].every(p=>Number.isInteger(p)&&p>1024&&p<65536)) throw Error('Invalid QA ports');
const database = await PGlite.create(),
  dialect = new PgDialect()
for (const table of Object.values(schema)) {
  if (table === schema.fibonacciObservation) continue
  const config = getTableConfig(table)
  const columns = config.columns.map((c) => {
    let d = ''
    if (c.default !== undefined) {
      const v = c.default
      d =
        ' DEFAULT ' +
        (typeof v === 'string'
          ? `'${v.replaceAll("'", "''")}'`
          : typeof v === 'number' || typeof v === 'boolean'
            ? String(v)
            : v?.queryChunks
              ? dialect.sqlToQuery(v).sql
              : "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb")
    }
    return `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${c.notNull ? ' NOT NULL' : ''}${d}`
  })
  await database.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`)
}
await migrateFibonacci({
  query: async (sql, args) =>
    args ? database.query(sql, args) : (await database.exec(sql)).at(-1),
})
await database.exec(readFileSync(new URL('../drizzle/0056_fibonacci_evidence.sql', import.meta.url),'utf8'));
await database.exec(readFileSync(new URL('../drizzle/0057_fibonacci_categorical_form.sql', import.meta.url),'utf8'));
await database.exec(readFileSync(new URL('../drizzle/0058_fibonacci_hierarchy.sql', import.meta.url),'utf8'));
const owner = 'fibonacci-local-qa',
  email = 'fibonacci-qa@example.invalid',
  password = 'Local-Fibonacci-QA-2026!'
await database.query(
  'INSERT INTO "user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',
  [owner, 'Lokale Fibonacci-Prüfung', email],
)
await database.query(
  'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES ($1,$2,\'credential\',$2,$3)',
  [randomUUID(), owner, await hashPassword(password)],
)
if (!process.argv.includes('--empty')) await database.query(
  "INSERT INTO stock(id,\"userId\",name,ticker,market) VALUES (1,$1,'Synthetische Aktie','FIBQA-S','aktien'),(2,$1,'Synthetisches Krypto','FIBQA-C','krypto')",
  [owner],
)
if (!process.argv.includes('--empty') && !process.argv.includes('--t3')) {
  const levels = [
    38.2, 50, 61.8, 61.8, 61.8, 78.6, 100, 61.8, 38.2, 61.8, 78.6, 127.2, 23.6,
    61.8, 50, 161.8, 38.2, 78.6, 61.8, 100, 50, 61.8, 61.8, 78.6,
  ]
  for (let i = 0; i < levels.length; i++)
    await database.query(
      'INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,note,evidence) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        randomUUID(),
        owner,
        i % 3 ? 1 : 2,
        i % 4 ? 'B' : '4',
        i % 5 ? 'Minor' : 'Primär',
        i % 5 ? '1d' : '1w',
        `2026-09-${String(i + 1).padStart(2, '0')}`,
        i === 0 ? 'laufend' : i === 1 ? 'ungueltig' : 'abgeschlossen',
        i % 3 === 0 ? levels[i] : null,
        'Synthetischer lokaler Prüffall ' +
          (i + 1) +
          ' – keine echten Marktdaten.',
        JSON.stringify({reachedLevels:i%3===1?[38.2]:[],missedLevels:i%3===1?[50]:[],reversalZone:i%3===2?[38.2,50]:null,hypotheticalCRV:i%2?5:null,provenance:'Synthetische lokale Erfassung'}),
      ],
    )
}
if (process.argv.includes('--t3')) {
  const root = '10000000-0000-4000-8000-000000000001';
  const entries = [
    [root, '4', null, {start:{precision:'day',date:'2008-01-01'},end:{precision:'day',date:'2008-12-31'}}],
    ['10000000-0000-4000-8000-000000000002', 'A', root, {start:{precision:'year',date:'2008'},end:{precision:'year',date:'2008'}}],
    ['10000000-0000-4000-8000-000000000003', 'C', root, {start:{precision:'month',date:'2008-03'},end:{precision:'month',date:'2008-04'}}],
    ['10000000-0000-4000-8000-000000000004', 'B', null, {start:{precision:'year',date:'2008',approximate:true},end:null}],
    ['10000000-0000-4000-8000-000000000005', '5', null, {start:{precision:'year',date:'2010'},end:{precision:'year',date:'2010'}}],
  ];
  for (const [id,wave,parentId,historicalTime] of entries) await database.query(
    `INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,note,evidence)
     VALUES($1,$1,$2,1,$3,'Minor','1d','2026-10-18','abgeschlossen',50,'Synthetischer T3-Prüffall – keine echten Marktdaten.',$4)`,
    [id,owner,wave,JSON.stringify({parentId,historicalTime,waveDirection:'long',provenance:'Synthetische lokale T3-Abnahme'})],
  );
}
if (process.argv.includes('--block-a')) {
  const {seedBlockA} = await import('./seed-block-a-qa.mjs');
  await seedBlockA(database,owner);
}
const server = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: qaDbPort,
  maxConnections: 20,
})
await server.start()
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${qaDbPort}/postgres`,
  DATABASE_URL_UNPOOLED:
    `postgresql://postgres:postgres@127.0.0.1:${qaDbPort}/postgres`,
  BETTER_AUTH_URL: `http://localhost:${qaPort}`,
  BETTER_AUTH_SECRET: 'local-fibonacci-qa-secret-only-2026-08-10',
  VERCEL_URL: '',
  VERCEL_PROJECT_PRODUCTION_URL: '',
  V0_RUNTIME_URL: `http://localhost:${qaPort}`,
  NEXT_TELEMETRY_DISABLED: '1',
}
const production = process.argv.includes('--production')
if (production) env.NODE_ENV = 'production'
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    ...(production ? ['start'] : ['dev', '--webpack']),
    '--hostname',
    '127.0.0.1',
    '--port',
    String(qaPort),
  ],
  {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
)
console.log(
  `LOCAL SYNTHETIC QA ONLY: http://localhost:${qaPort}/analysis; sign in fibonacci-qa@example.invalid / Local-Fibonacci-QA-2026!`,
)
async function stop() {
  child.kill()
  await server.stop()
  await database.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', async () => {
  await server.stop()
  await database.close()
  process.exit(0)
})
