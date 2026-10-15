import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/** All automatic callers share 150 attempts/hour, and one success/series/hour.
 * Failed/aborted calls consume their reservation too. Continuations cannot
 * reopen either budget. No credentials or personal payloads are recorded. */
export async function reserveAutomaticCandles(key: string, since?: number, role:'execution'|'archive'='execution') {
  const now = new Date(), hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000)
  const token = randomUUID()
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout='4s'`)
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`)
    await tx.execute(sql`INSERT INTO automatic_candle_budget(hour) VALUES (${hour.toISOString()}) ON CONFLICT DO NOTHING`)
    const budget = await tx.execute(sql`SELECT attempts FROM automatic_candle_budget WHERE hour=${hour.toISOString()} FOR UPDATE`)
    const found = await tx.execute(sql`SELECT * FROM automatic_candle_fetch WHERE key=${key} FOR UPDATE`)
    const previous = found.rows[0] as undefined | { hour: Date; completedAt: Date | null; error: string | null; since: number | null; leaseUntil: Date;attemptedAt:Date;attempts:number }
    if (previous && new Date(previous.leaseUntil) > now) throw new Error('Kursreihe wird bereits gesammelt; Fortsetzung beim nächsten Aufruf.')
    if (previous && new Date(previous.hour).getTime() === hour.getTime()) {
      if (previous.completedAt && !previous.error && (previous.since == null || since != null && previous.since <= since)) return { reused: true, token: null,completedAt:new Date(previous.completedAt).toISOString() }
      if ((previous.completedAt&&!previous.error) || previous.attempts>=3 || now.getTime()-new Date(previous.attemptedAt).getTime()<300_000) {
        throw new Error('Stündlicher Abruf dieser Kursreihe bereits reserviert; Wiederholung begrenzt oder ältere Datenanforderung offen.')
      }
    }
    if (Number(budget.rows[0]?.attempts) >= 150) throw new Error('Stündliches kostenloses Abrufbudget ausgeschöpft.')
    if(role==='archive'&&Number(budget.rows[0]?.attempts)>=140){
      const priority=await tx.execute(sql`SELECT c."portfolioId" FROM demo_cycle_state c JOIN portfolio p ON p.id=c."portfolioId" AND p."userId"=c."userId"
        WHERE c.enabled=true AND p.kind='demo' AND p."archivedAt" IS NULL AND (c.phase<>'idle' OR c."nextRunAt"<=now()) LIMIT 1`)
      if(priority.rows.length)throw new Error('Letzte zehn Abrufplätze bleiben für den fälligen eigenen Demozyklus frei.')
    }
    // A conservative shared limit also protects the limited-credit provider.
    if (key.startsWith('twelvedata|')) {
      const recent = await tx.execute(sql`SELECT key FROM automatic_candle_fetch WHERE key LIKE 'twelvedata|%' AND hour=${hour.toISOString()} AND "leaseUntil">${new Date(now.getTime() - 60_000).toISOString()} LIMIT 1`)
      if (recent.rows.length) throw new Error('Begrenzte Quelle wartet auf ihr gemeinsames Abrufkontingent.')
      const day=hour.toISOString().slice(0,10)
      await tx.execute(sql`INSERT INTO automatic_provider_day(provider,day)VALUES('twelvedata',${day}) ON CONFLICT DO NOTHING`)
      const daily=await tx.execute(sql`UPDATE automatic_provider_day SET attempts=attempts+1 WHERE provider='twelvedata' AND day=${day} AND attempts<800 RETURNING attempts`)
      if(!daily.rows.length)throw new Error('Tägliches kostenloses Quellenkontingent ausgeschöpft.')
    }
    await tx.execute(sql`UPDATE automatic_candle_budget SET attempts=attempts+1 WHERE hour=${hour.toISOString()}`)
    const attempts=previous&&new Date(previous.hour).getTime()===hour.getTime()?previous.attempts+1:1
    await tx.execute(sql`INSERT INTO automatic_candle_fetch(key,hour,"leaseUntil",token,since,attempts,"attemptedAt") VALUES
      (${key},${hour.toISOString()},${new Date(now.getTime()+90_000).toISOString()},${token},${since ?? null},${attempts},${now.toISOString()})
      ON CONFLICT(key) DO UPDATE SET hour=excluded.hour,"leaseUntil"=excluded."leaseUntil",token=excluded.token,since=excluded.since,attempts=excluded.attempts,"attemptedAt"=excluded."attemptedAt","completedAt"=NULL,error=NULL`)
    return { reused: false, token }
  })
}

export async function finishAutomaticCandles(key: string, token: string, error: string | null) {
  const result=await db.execute(sql`UPDATE automatic_candle_fetch SET "completedAt"=now(),"leaseUntil"=now(),error=${error} WHERE key=${key} AND token=${token} RETURNING "completedAt"`)
  const row=result.rows[0] as {completedAt:Date}|undefined
  if(!row)throw new Error('Abrufreservation verloren; kein erfolgreicher Quellenbeleg.')
  return new Date(row.completedAt).toISOString()
}
