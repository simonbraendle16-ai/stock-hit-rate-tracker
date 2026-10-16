import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db,withDatabaseDeadline } from '@/lib/db'
import { trade, tradeEvent,stock, brokerOrder,candleSeries } from '@/lib/db/schema'
import { planGaps } from '@/lib/plan-context'
import { requiresPreTradeGate } from '@/lib/trade-kind'
import { demoSourceIssue } from '@/lib/demo-source'
import { pruefBeginn, closedExchangeGap } from '@/lib/demo-progress'
import { runDemoFills } from '@/lib/demo-run'
import { getCachedCandles } from '@/lib/market-data/cached'
import type { Market, ProviderName } from '@/lib/market-data'
import type {SessionCandles} from '@/lib/market-data/execution-session'
import type {Candle} from '@/lib/market-data/types'

export const DEMO_CYCLE_INTERVAL_MS = 3_600_000
// cron-job.org's default limit is 30s, tighter than the hosting route's 60s.
// Keep 10s for persistence/response; a continuation gets the remaining work.
export const DEMO_CYCLE_BUDGET_MS = 20_000
export type CycleScope = { userId: string; portfolioId: number }
type Source = { stockId: number; symbol: string; provider: ProviderName; market: Market; since: number; fetchedAt?: string; error?: string;attempts?:number;retryAt?:number }
export type CycleResult = { status: string; reason?: string; checkedAt?: string | null; bookings?: number; requiredUntil?: string; sourceFetchedAt?: string }
type Work = { sources: Source[]; pending: number[]; asOf: number;processAttempts?:Record<string,number> }
export type CycleState = CycleScope & { enabled: boolean; nextRunAt: Date; leaseUntil: Date; cycleId: string | null; cycleStartedAt: Date | null;
  completedAt: Date | null; lastAutomaticAt: Date | null; lastAttemptAt: Date | null; phase: 'idle'|'collect'|'process';
  work: Work | Record<string, never>; results: Record<string, CycleResult>; error: string | null }

export function configuredDemoScope(): CycleScope | null {
  const userId = process.env.DEMO_CYCLE_USER_ID, portfolioId = Number(process.env.DEMO_CYCLE_PORTFOLIO_ID)
  return userId && Number.isSafeInteger(portfolioId) && portfolioId > 0 ? { userId, portfolioId } : null
}

export async function readDemoCycle(scope: CycleScope): Promise<CycleState | null> {
  const result = await db.execute(sql`SELECT c.* FROM demo_cycle_state c JOIN portfolio p ON p.id=c."portfolioId" AND p."userId"=c."userId"
    WHERE c."portfolioId"=${scope.portfolioId} AND c."userId"=${scope.userId} AND p.kind='demo' AND p."archivedAt" IS NULL`)
  return result.rows[0] as CycleState | undefined ?? null
}

async function cycleBookings(scope:CycleScope,tradeId:number,cycleId:string){
  const events=await db.select({payload:tradeEvent.payload,note:tradeEvent.note}).from(tradeEvent).where(and(eq(tradeEvent.userId,scope.userId),eq(tradeEvent.tradeId,tradeId),sql`${tradeEvent.payload} LIKE ${`%${cycleId}%`}`)).limit(1000)
  let bookings=0,rejectedReason:string|null=null
  for(const event of events){try{
    const p=JSON.parse(event.payload??'{}')
    if(p.quelle!=='demo-fill'||p.cycleId!==cycleId)continue
    if(p.grund==='ungedeckt')rejectedReason=event.note??'Einstieg wegen unzureichender Deckung verworfen.'
    else if(['einstieg','teilziel','ziel','stop'].includes(p.art))bookings++
  }catch{/* Older unrelated invalid payloads cannot become evidence. */}}
  return {bookings,rejectedReason}
}

async function initialWork(scope: CycleScope, asOf: number) {
  const rows = await db.select({ t: trade, s: stock }).from(trade).leftJoin(stock, and(eq(stock.id, trade.stockId), eq(stock.userId, trade.userId)))
    .where(and(eq(trade.userId, scope.userId), eq(trade.portfolioId, scope.portfolioId), inArray(trade.status, ['geplant','aktiv'])))
  const links = await db.select({ id: brokerOrder.linkedTradeId }).from(brokerOrder).where(and(eq(brokerOrder.userId, scope.userId), eq(brokerOrder.portfolioId, scope.portfolioId)))
  const linked = new Set(links.map(x => x.id)), results: Record<string, CycleResult> = {}, sources: Source[] = [], pending: number[] = []
  rows.sort((a,b) => Number(a.t.status !== 'aktiv') - Number(b.t.status !== 'aktiv') || Number(Boolean(a.t.demoIssue))-Number(Boolean(b.t.demoIssue)) || a.t.id-b.t.id)
  for (const {t,s} of rows) {
    const gaps = t.status === 'geplant' && requiresPreTradeGate(t.tradeKind) ? planGaps(t) : []
    const issue = demoSourceIssue(s, t.market, t.ticker) || (!s?.provider || !['yahoo','twelvedata','binance'].includes(s.provider) ? 'Bestätigter Kursanbieter fehlt.' : null)
      || (!t.quoteCurrency || !t.accountCurrency ? 'Währungszuordnung des Altbestands fehlt.' : null)
      || (s?.resolvedCurrency && s.resolvedCurrency !== t.quoteCurrency ? 'Kurswährung und Instrument widersprechen sich.' : null)
    if (linked.has(t.id)) { results[t.id] = { status:'broker', reason:'Brokerbeleg verknüpft; keine zusätzliche Simulation.' }; continue }
    if (gaps.length || issue) { results[t.id] = { status:'blocked', reason:gaps.length ? gaps.join('; ') : issue! }; continue }
    const since = Math.floor(pruefBeginn(t, []).beginn.getTime()/1000) - (t.demoCheckedAt ? 300 : 7*86400)
    const existing = sources.find(x => x.symbol===s!.providerSymbol && x.provider===s!.provider && x.market===t.market)
    if (existing) existing.since = Math.min(existing.since, since)
    else sources.push({ stockId:s!.id, symbol:s!.providerSymbol!, provider:s!.provider as ProviderName, market:t.market as Market, since })
    pending.push(t.id)
    results[t.id] = { status:'pending', checkedAt:t.demoCheckedAt?.toISOString() ?? null }
  }
  return { work:{ sources, pending, asOf }, results }
}

/** An invocation owns one persisted lease, not an in-memory promise. Each
 * source/trade commits its progress. A killed invocation resumes the same
 * cycle and cutoff; it cannot refill budgets or count as a completed cycle. */
export async function runDemoCycle(scope: CycleScope, trigger: 'automatic'|'manual' = 'automatic') {
  return withDatabaseDeadline(Date.now()+26_000,()=>performDemoCycle(scope,trigger))
}
async function performDemoCycle(scope: CycleScope, trigger: 'automatic'|'manual') {
  const started = Date.now(), id = randomUUID(), token = randomUUID()
  const deadline = started + DEMO_CYCLE_BUDGET_MS
  const owned = await readDemoCycle(scope)
  if (!owned?.enabled) throw new Error('Eigener Demozyklus ist nicht aktiviert oder das Depot ist nicht gültig.')
  const state = await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout='4s'`)
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`)
    await tx.execute(sql`UPDATE demo_cycle_state SET "lastAttemptAt"=now(),"lastAutomaticAt"=CASE WHEN ${trigger}='automatic' THEN now() ELSE "lastAutomaticAt" END
      WHERE "portfolioId"=${scope.portfolioId} AND "userId"=${scope.userId} AND enabled=true`)
    const claim = await tx.execute(sql`UPDATE demo_cycle_state SET "leaseToken"=${token},"leaseUntil"=now()+interval '90 seconds'
      WHERE "portfolioId"=${scope.portfolioId} AND "userId"=${scope.userId} AND enabled=true AND "leaseUntil"<=now()
      AND (phase<>'idle' OR "nextRunAt"<=now()) RETURNING *`)
    await tx.execute(sql`INSERT INTO demo_cycle_tick(id,"portfolioId","userId",trigger,outcome,"finishedAt")
      VALUES(${id},${scope.portfolioId},${scope.userId},${trigger},${claim.rows.length ? 'running':'not-due-or-leased'},${claim.rows.length ? null : new Date().toISOString()})`)
    return claim.rows[0] as CycleState | undefined
  })
  if (!state) return { accepted:true, processed:false, completed:false, reason:'Nicht fällig oder bereits in Arbeit.' }
  let work = state.work as Work, results = state.results, cycleId = state.cycleId
  const save = async (phase: CycleState['phase']) => {
    const saved = await db.execute(sql`UPDATE demo_cycle_state SET phase=${phase},work=${JSON.stringify(work)}::jsonb,results=${JSON.stringify(results)}::jsonb,"cycleId"=${cycleId},error=NULL
      WHERE "portfolioId"=${scope.portfolioId} AND "userId"=${scope.userId} AND "leaseToken"=${token} AND "leaseUntil">now() AND enabled=true RETURNING "portfolioId"`)
    if (!saved.rows.length) throw new Error('Depotzyklus-Lease verloren.')
  }
  try {
    if (state.phase==='idle') {
      const initial = await initialWork(scope, started)
      work=initial.work; results=initial.results; cycleId=randomUUID()
      await db.execute(sql`UPDATE demo_cycle_state SET "cycleStartedAt"=${new Date(started).toISOString()} WHERE "portfolioId"=${scope.portfolioId} AND "userId"=${scope.userId} AND "leaseToken"=${token}`)
      await save('collect')
    }
    await db.execute(sql`UPDATE demo_cycle_tick SET "cycleId"=${cycleId} WHERE id=${id}`)
    // A 10s provider call plus bounded database writes needs a finishing reserve.
    for (const source of work.sources) {
      if (source.fetchedAt || (source.attempts??0)>=3 || (source.retryAt??0)>Date.now()) continue
      if (Date.now()+14_000 > deadline) break
      try {
        source.attempts=(source.attempts??0)+1
        const candles=await getCachedCandles(source.symbol, source.market, '5min', { since:source.since, limit:1, forceRefresh:true, requireFresh:true, automatic:true, provider:source.provider }) as SessionCandles<Candle>
        const proof=candles.automaticProof
        if(!proof||proof.key!==`${source.provider}|${source.market}|${source.symbol}|5min`||!Number.isFinite(Date.parse(proof.completedAt)))throw new Error('Kein erfolgreicher passender Quellenbeleg für diesen Zyklus.')
        source.fetchedAt=proof.completedAt;delete source.error
      } catch (error) { source.error=error instanceof Error ? error.message : 'Kursabruf fehlgeschlagen.';source.retryAt=Date.now()+300_000 }
      await save('collect')
    }
    const collectionPending = work.sources.some(s=>!s.fetchedAt&&(s.attempts??0)<3)
    {
      await save('process')
      for (const tradeId of [...work.pending]) {
        if (Date.now()+12_000 > deadline) break
        const [current] = await db.select().from(trade).where(and(eq(trade.id,tradeId),eq(trade.userId,scope.userId),eq(trade.portfolioId,scope.portfolioId)))
        if (!current || !['geplant','aktiv'].includes(current.status)) {
          const execution=current?await cycleBookings(scope,tradeId,cycleId!):{bookings:0,rejectedReason:null}
          results[tradeId]=execution.rejectedReason?{status:'blocked',reason:execution.rejectedReason}:execution.bookings?{status:'booked',bookings:execution.bookings,checkedAt:current.demoCheckedAt?.toISOString()??null}:{ status:'changed', reason:'Fall inzwischen geändert oder abgeschlossen.' }
          work.pending=work.pending.filter(x=>x!==tradeId); await save('process'); continue
        }
        const gaps=current.status==='geplant'&&requiresPreTradeGate(current.tradeKind)?planGaps(current):[]
        if(gaps.length){
          results[tradeId]={status:'blocked',reason:gaps.join('; ')}
          work.pending=work.pending.filter(x=>x!==tradeId);await save('process');continue
        }
        const [instrument] = current.stockId==null ? [] : await db.select().from(stock).where(and(eq(stock.id,current.stockId),eq(stock.userId,scope.userId)))
        const source = work.sources.find(s=>s.symbol===instrument?.providerSymbol&&s.provider===instrument.provider&&s.market===current.market)
        if (!source?.fetchedAt || source.error) {
          results[tradeId]={ status:'blocked', reason:source?.error ?? 'Instrument seit Sammlung geändert; neuer Zyklus erforderlich.' }
          if (!source||(source.attempts??0)>=3) work.pending=work.pending.filter(x=>x!==tradeId)
          await save('process'); continue
        }
        const report = await db.transaction(async tx => {
          await tx.execute(sql`SET LOCAL statement_timeout='6s'`)
          await tx.execute(sql`SET LOCAL lock_timeout='2s'`)
          await tx.execute(sql`SET LOCAL transaction_timeout='10s'`)
          return runDemoFills({ ...scope, tradeId, refresh:false, maxMs:8_000, cycleId:cycleId!, cycleToken:token, asOf:work.asOf,
            prepared:{ symbol:source.symbol, provider:source.provider, stockId:current.stockId, fetchedAt:source.fetchedAt! } })
        })
        const [after] = await db.select().from(trade).where(and(eq(trade.id,tradeId),eq(trade.userId,scope.userId),eq(trade.portfolioId,scope.portfolioId)))
        const execution=await cycleBookings(scope,tradeId,cycleId!),bookings=execution.bookings
        const blocked = execution.rejectedReason||report.ungedeckt.length||report.error || report.unvollstaendig.length || report.ohneKerzen.length
        const checkedAt = after?.demoCheckedAt?.toISOString() ?? null
        const cutoff = Math.floor(work.asOf/300_000)*300
        const checked = after?.demoCheckedAt ? after.demoCheckedAt.getTime()/1000 : 0
        const [series]=await db.select({session:candleSeries.executionSession}).from(candleSeries).where(and(eq(candleSeries.symbol,source.symbol),eq(candleSeries.interval,'5min'))).limit(1)
        const session=series?.session?.symbol===source.symbol?series.session:null
        const closed = current.market!=='krypto'&&checked>0 && closedExchangeGap(checked,cutoff,instrument?.resolvedExchange,session)
        const covered = checked>=cutoff || closed
        // A fresh successful fetch can still end before this cycle's cutoff.
        // Missing tail data is not an interior gap and must never imply full coverage.
        const terminal = after && !['geplant','aktiv'].includes(after.status)
        const status = blocked ? 'blocked' : report.ausstehend.length ? 'pending' : terminal && bookings ? 'booked'
          : !covered ? 'awaiting-data' : bookings ? 'booked' : closed ? 'market-closed' : 'checked'
        results[tradeId]={ status, checkedAt, bookings, requiredUntil:new Date(cutoff*1000).toISOString(),sourceFetchedAt:source.fetchedAt,
          ...(status==='blocked' ? { reason:execution.rejectedReason||after?.demoIssue || report.error || 'Keine verwertbaren Kursdaten.' }
            : status==='awaiting-data' ? {reason:'Kursreihe reicht noch nicht bis zur Zyklusgrenze. Verarbeitung erfolgt bis zur belegten Prüfgrenze; Fortsetzung im nächsten Stundenzyklus.'} : {}) }
        if(report.error){
          work.processAttempts??={}
          work.processAttempts[tradeId]=(work.processAttempts[tradeId]??0)+1
        }
        const retry=Boolean(report.error)&&(work.processAttempts?.[tradeId]??0)<3
        if (!report.ausstehend.length&&!retry) work.pending=work.pending.filter(x=>x!==tradeId)
        await save('process')
      }
    }
    const completed=!collectionPending&&!work.pending.length
    await db.execute(sql`UPDATE demo_cycle_state SET phase=${completed?'idle':collectionPending?'collect':'process'},"leaseUntil"=now(),"leaseToken"=NULL,
      "completedAt"=CASE WHEN ${completed} THEN now() ELSE "completedAt" END,
      "nextRunAt"=CASE WHEN ${completed} THEN greatest(now(),"cycleStartedAt"+interval '1 hour') ELSE now()+interval '5 minutes' END
      WHERE "portfolioId"=${scope.portfolioId} AND "userId"=${scope.userId} AND "leaseToken"=${token}`)
    const report={ accepted:true, processed:true, completed, cycleId, pending:work.pending.length, blocked:Object.values(results).filter(r=>r.status==='blocked').length, durationMs:Date.now()-started }
    const audit={...report,cutoff:new Date(work.asOf).toISOString(),results,
      sources:work.sources.map(({symbol,provider,fetchedAt,error})=>({symbol,provider,fetchedAt,error}))}
    await db.execute(sql`UPDATE demo_cycle_tick SET "finishedAt"=now(),outcome=${completed?'completed':'continued'},report=${JSON.stringify(audit)}::jsonb WHERE id=${id}`)
    return report
  } catch (error) {
    const message=error instanceof Error?error.message:'Demozyklus fehlgeschlagen.'
    await db.execute(sql`UPDATE demo_cycle_state SET error=${message},"leaseUntil"=now(),"leaseToken"=NULL WHERE "portfolioId"=${scope.portfolioId} AND "userId"=${scope.userId} AND "leaseToken"=${token}`)
    await db.execute(sql`UPDATE demo_cycle_tick SET "finishedAt"=now(),outcome='error',report=${JSON.stringify({error:message})}::jsonb WHERE id=${id}`)
    throw error
  }
}
