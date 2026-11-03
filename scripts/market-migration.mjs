import { createHash } from 'node:crypto'

// Explicit allowlist; never accepts a caller-supplied SQL identifier.
const tables = {
  candle_cache: { keys: ['symbol','interval','time'], columns: ['symbol','interval','time','open','high','low','close','volume'] },
  candle_series: { keys: ['symbol','interval'], columns: ['symbol','interval','market','firstTime','lastTime','candleCount','fetchedAt','lastError','failCount','executionSession'] },
  candle_collect_run: { keys: ['id'], columns: ['id','startedAt','finishedAt','trigger','seriesDue','seriesFetched','seriesFailed','candlesAdded','error'] },
}
const quote = name => '"' + name + '"'
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value)
  ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])])) : value
export async function transaction(client, callback) {
  await client.query('BEGIN')
  try { const result = await callback(); await client.query('COMMIT'); return result }
  catch (e) { await client.query('ROLLBACK'); throw e }
}
export async function setMarketWritable(client, writable) {
  return transaction(client, async () => {
    // Exclusive counterpart to every writer's shared trigger lock: drains writers.
    await client.query('SELECT pg_advisory_xact_lock(731903)')
    const result = await client.query('UPDATE market_data_control SET writable=$1,generation=generation+CASE WHEN writable IS DISTINCT FROM $1 THEN 1 ELSE 0 END,changed_at=now() WHERE id=1 RETURNING generation', [writable])
    if (result.rows.length !== 1) throw new Error('Marktdatenkontrolle fehlt.')
    return result.rows[0].generation
  })
}
async function assertFrozen(client) {
  const {rows} = await client.query('SELECT writable,generation FROM market_data_control WHERE id=1')
  if (rows.length !== 1 || rows[0].writable) throw new Error('Beide Marktdatenziele müssen gesperrt sein.')
  return rows[0].generation
}
async function* packages(client) {
  let after = ''
  while (true) {
    const { rows } = await client.query(`SELECT symbol FROM (SELECT symbol FROM candle_cache UNION SELECT symbol FROM candle_series) s WHERE symbol > $1 ORDER BY symbol LIMIT 100`, [after])
    if (!rows.length) return
    for (const r of rows) yield r.symbol
    after = rows.at(-1).symbol
  }
}
async function* pages(client, table, symbol) {
  const { keys,columns } = tables[table]
  // pg's JavaScript Date parser truncates microseconds. Read timestamps as
  // exact UTC text so hashing, resume and reverse copy retain all 6 digits.
  const fields = columns.map(column => ['fetchedAt','startedAt','finishedAt'].includes(column)
    ? `to_char(${quote(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${quote(column)}`
    : quote(column)).join(',')
  let last
  while (true) {
    const values = [], conditions = []
    if (symbol != null) { values.push(symbol); conditions.push('symbol=$1') }
    if (last) {
      const placeholders = keys.map(k => { values.push(last[k]); return '$'+values.length })
      conditions.push('('+keys.map(quote).join(',')+') > ('+placeholders.join(',')+')')
    }
    const {rows} = await client.query(`SELECT ${fields} FROM ${table}${conditions.length ? ' WHERE '+conditions.join(' AND ') : ''} ORDER BY ${keys.map(quote).join(',')} LIMIT 500`,values)
    if (!rows.length) return
    yield rows
    last = rows.at(-1)
  }
}
async function digest(client, table, symbol) {
  const hash = createHash('sha256'); let count=0, bytes=0
  for await (const rows of pages(client,table,symbol)) for (const row of rows) {
    const payload=JSON.stringify(canonical(row))+'\n'; hash.update(payload); bytes+=Buffer.byteLength(payload); count++
  }
  return { digest: hash.digest('hex'), count, bytes }
}
async function copyTable(source,target,table,symbol) {
  const fields=tables[table].columns.map(quote).join(',')
  await target.query(`DELETE FROM ${table}${symbol == null ? '' : ' WHERE symbol=$1'}`,symbol==null?[]:[symbol])
  let bytes=0, count=0
  for await (const rows of pages(source,table,symbol)) {
    const payload=JSON.stringify(rows); bytes+=Buffer.byteLength(payload); count+=rows.length
    await target.query(`INSERT INTO ${table} (${fields}) SELECT ${fields} FROM json_populate_recordset(NULL::${table},$1::json)`,[payload])
  }
  return {bytes,count}
}

/** Run only after explicit fencing, on dedicated direct connections.
 * Each symbol and its metadata is replaced in one target transaction. A failed
 * package rolls back; committed packages resume by matching content hashes.
 * Calling in reverse after fencing B preserves NEW/changed/deleted target rows.
 * No source deletes, dual writes, configuration changes or distributed commit. */
export async function copyMarketPackages(source,target,migration,options={}) {
  if(source===target)throw new Error('Getrennte Migrationsverbindungen erforderlich.')
  const locked=[]
  try {
    // Direct sessions only: prevent concurrent copy/freeze/unfreeze throughout
    // verification. try-lock both directions so a competing rollback fails fast.
    for(const client of [source,target]) {
      const result=await client.query('SELECT pg_try_advisory_lock(731903) AS locked')
      if(!result.rows[0]?.locked)throw new Error('Marktdatenmigration oder Schreiber noch aktiv.')
      locked.push(client)
    }
    return await copyFrozenPackages(source,target,migration,options)
  } finally {for(const client of locked.reverse())await client.query('SELECT pg_advisory_unlock(731903)').catch(()=>{})}
}
async function copyFrozenPackages(source,target,migration,options={}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(migration)) throw new Error('Ungültige Migrationskennung.')
  const sourceGeneration=await assertFrozen(source),targetGeneration=await assertFrozen(target)
  const migrationKey=`${migration}-${sourceGeneration}-${targetGeneration}`
  const report={copied:0,resumed:0,rows:0,payloadBytes:0,verifiedBytes:0,targetVerifiedBytes:0}
  // Include target-only symbols so rollback also propagates deletions.
  const symbols=new Set()
  for await (const symbol of packages(source)) symbols.add(symbol)
  for await (const symbol of packages(target)) symbols.add(symbol)
  const jobs=[...[...symbols].sort().map(s=>({key:'symbol:'+s,symbol:s,tables:['candle_cache','candle_series']})),
    {key:'collect-runs',symbol:null,tables:['candle_collect_run']}]
  for (const job of jobs) {
    if (await assertFrozen(source)!==sourceGeneration || await assertFrozen(target)!==targetGeneration) throw new Error('Sperrgeneration verändert; Abbruch.')
    const before=await Promise.all(job.tables.map(t=>digest(source,t,job.symbol)))
    const combined=createHash('sha256').update(JSON.stringify(before.map(x=>({digest:x.digest,count:x.count})))).digest('hex')
    report.verifiedBytes+=before.reduce((s,r)=>s+r.bytes,0)
    const checkpoint=await target.query('SELECT digest FROM market_migration_package WHERE migration=$1 AND package=$2',[migrationKey,job.key])
    if(checkpoint.rows[0]?.digest===combined) {
      const actual=await Promise.all(job.tables.map(t=>digest(target,t,job.symbol)))
      report.targetVerifiedBytes+=actual.reduce((s,r)=>s+r.bytes,0)
      if(actual.every((r,i)=>r.digest===before[i].digest&&r.count===before[i].count)) { report.resumed++; continue }
    }
    await transaction(target,async()=>{
      await target.query("SET LOCAL tracker.market_migration='on'")
      for(const t of job.tables) { const r=await copyTable(source,target,t,job.symbol);report.rows+=r.count;report.payloadBytes+=r.bytes }
      const after=await Promise.all(job.tables.map(t=>digest(target,t,job.symbol)))
      report.targetVerifiedBytes+=after.reduce((s,r)=>s+r.bytes,0)
      if(!after.every((r,i)=>r.digest===before[i].digest&&r.count===before[i].count)) throw new Error('Paketprüfung fehlgeschlagen.')
      await target.query('INSERT INTO market_migration_package(migration,package,digest) VALUES($1,$2,$3) ON CONFLICT(migration,package) DO UPDATE SET digest=excluded.digest,copied_at=now()',[migrationKey,job.key,combined])
    })
    report.copied++
    await options.afterPackage?.(report.copied)
  }
  const sourceSequence=(await source.query('SELECT last_value,is_called FROM candle_collect_run_id_seq')).rows[0]
  const targetSequence=(await target.query('SELECT last_value,is_called FROM candle_collect_run_id_seq')).rows[0]
  if(await assertFrozen(source)!==sourceGeneration||await assertFrozen(target)!==targetGeneration)throw new Error('Sperrgeneration verändert; Abbruch.')
  await transaction(target,async()=>{
    await target.query("SELECT setval(pg_get_serial_sequence('candle_collect_run','id'),GREATEST(COALESCE((SELECT max(id) FROM candle_collect_run),0),$1::bigint,$2::bigint,1),$3::boolean OR (SELECT count(*)>0 FROM candle_collect_run))",[sourceSequence.last_value,targetSequence.last_value,sourceSequence.is_called||targetSequence.is_called])
  })
  return report
}
