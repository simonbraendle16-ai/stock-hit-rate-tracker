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
if (!process.argv.includes('--empty')) {
  const levels = [
    38.2, 50, 61.8, 61.8, 61.8, 78.6, 100, 61.8, 38.2, 61.8, 78.6, 127.2, 23.6,
    61.8, 50, 161.8, 38.2, 78.6, 61.8, 100, 50, 61.8, 61.8, 78.6,
  ]
  for (let i = 0; i < levels.length; i++)
    await database.query(
      'INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,note) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        randomUUID(),
        owner,
        i % 3 ? 1 : 2,
        i % 4 ? 'B' : '4',
        i % 5 ? 'Minor' : 'Primär',
        i % 5 ? '1d' : '1w',
        `2026-09-${String(i + 1).padStart(2, '0')}`,
        i === 0 ? 'laufend' : i === 1 ? 'ungueltig' : 'abgeschlossen',
        levels[i],
        'Synthetischer lokaler Prüffall ' +
          (i + 1) +
          ' – keine echten Marktdaten.',
      ],
    )
}
const server = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: 5548,
  maxConnections: 20,
})
await server.start()
const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5548/postgres',
  DATABASE_URL_UNPOOLED:
    'postgresql://postgres:postgres@127.0.0.1:5548/postgres',
  BETTER_AUTH_URL: 'http://localhost:3018',
  BETTER_AUTH_SECRET: 'local-fibonacci-qa-secret-only-2026-08-10',
  VERCEL_URL: '',
  VERCEL_PROJECT_PRODUCTION_URL: '',
  V0_RUNTIME_URL: 'http://localhost:3018',
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
    '3018',
  ],
  {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
)
console.log(
  'LOCAL SYNTHETIC QA ONLY: http://localhost:3018/analysis; sign in fibonacci-qa@example.invalid / Local-Fibonacci-QA-2026!',
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
