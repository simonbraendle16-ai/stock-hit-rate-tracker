// Explicitly scoped legacy repair. Default previews; --apply writes with row locks.
// npx tsx --env-file=.env.local scripts/repair-demo-history.ts --ids=... --discard=... --archive=... [--apply]
import { mkdirSync, writeFileSync } from 'node:fs'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db'
import { brokerOrder, candleCache, stock, trade, tradeEvent, tradeTarget } from '../lib/db/schema'
import { withTradeLock } from '../lib/trade-lock'
import { createSymbolResolver } from '../lib/market-data/lookup'
import { pruefBeginn } from '../lib/demo-progress'
import { repairDemoArchive, runDemoFills } from '../lib/demo-run'
import { readStoredCandles } from '../lib/market-data/candle-store'
import { yahooProvider } from '../lib/market-data/yahoo'
import type { Candle } from '../lib/market-data/types'

async function main() {
const args = process.argv.slice(2)
if (args.some((arg) => !/^(--apply|--ids=\d+(,\d+)*|--discard=\d+|--archive=\d+)$/.test(arg))) throw new Error('Ungültige Argumente.')
const ids = args.find((a) => a.startsWith('--ids='))?.slice(6).split(',').map(Number) ?? []
const discardId = Number(args.find((a) => a.startsWith('--discard='))?.slice(10))
const archiveId = Number(args.find((a) => a.startsWith('--archive='))?.slice(10))
const apply = args.includes('--apply')
if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new Error('1 bis 10 eindeutige Trade-IDs erforderlich.')
if (discardId && !ids.includes(discardId) || archiveId && !ids.includes(archiveId)) throw new Error('Sonderfälle müssen in --ids stehen.')
const directory = '.baseline-demo-repair'
mkdirSync(directory, { recursive: true })
const label = new Date().toISOString().replace(/[:.]/g, '-')

async function refillGap(symbol: string, from: number, until: number) {
  const url = new URL('https://api.twelvedata.com/time_series')
  const sourceSymbol = symbol.replace(/-USD$/, '/USD')
  for (const [key, value] of Object.entries({ symbol: sourceSymbol, interval: '5min', timezone: 'UTC',
    start_date: new Date(from * 1000).toISOString().slice(0, 19).replace('T', ' '),
    end_date: new Date(until * 1000).toISOString().slice(0, 19).replace('T', ' '),
    outputsize: '5000', order: 'asc', apikey: process.env.TWELVEDATA_API_KEY ?? '' })) url.searchParams.set(key, value)
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const data = await response.json()
  if (!response.ok || data.status !== 'ok' || data.meta?.symbol !== sourceSymbol || data.meta.interval !== '5min') throw new Error('Quelle kann die zusätzliche Lücke nicht belegen.')
  const candles: Candle[] = data.values.map((v: Record<string, string>) => ({ time: Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000,
    open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume ?? 0),
  }))
  if (!candles.length || candles.some((c) => c.time % 300 !== 0 || ![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite) || c.high < c.low)) throw new Error('Ungültige Archivkerzen.')
  writeFileSync(`${directory}/${label}-${symbol.replace(/[^A-Z0-9]/g, '')}-${from}-gap-source.json`, JSON.stringify({ source: 'twelvedata', meta: data.meta, candles }))
  await db.insert(candleCache).values(candles.map((c) => ({ ...c, symbol, interval: '5min' }))).onConflictDoNothing()
  return candles.length
}

try {
  const trades = (await db.select().from(trade).where(inArray(trade.id, ids))).sort((a, b) => Number(b.id === discardId) - Number(a.id === discardId))
  if (trades.length !== ids.length) throw new Error('Mindestens ein Trade fehlt.')
  const events = await db.select().from(tradeEvent).where(inArray(tradeEvent.tradeId, ids))
  const targets = await db.select().from(tradeTarget).where(inArray(tradeTarget.tradeId, ids))
  writeFileSync(`${directory}/${label}-before.json`, JSON.stringify({ trades, events, targets }, null, 2))
  const reports: unknown[] = []
  for (const t of trades) {
    await withTradeLock(t.userId, t.id, async (current, depot) => {
      if (depot.kind !== 'demo') throw new Error('Nur Demo-Trades dürfen repariert werden.')
      const links = await db.select().from(brokerOrder).where(and(eq(brokerOrder.userId, t.userId), eq(brokerOrder.linkedTradeId, t.id))).limit(1)
      if (links.length) throw new Error('Brokerverknüpfte Trades sind ausgeschlossen.')
      if (current.status !== t.status || current.demoCheckedAt?.getTime() !== t.demoCheckedAt?.getTime()) throw new Error('Trade wurde zwischenzeitlich geändert.')
    })
    if (t.id === discardId) {
      await withTradeLock(t.userId, t.id, async (current) => {
        if (current.status === 'kein_handel') return
        if (current.status !== 'geplant' || current.positionSize != null) throw new Error('Nur ungehandelter Plan ohne Positionsgröße darf verworfen werden.')
        if (apply) {
          const note = 'Auf ausdrücklichen Nutzerwunsch verworfen: alter Demo-Plan ohne Positionsgröße.'
          await db.update(trade).set({ status: 'kein_handel', noTradeNote: note, closedAt: new Date(), demoIssue: null })
            .where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
          await db.insert(tradeEvent).values({ tradeId: t.id, userId: t.userId, type: 'notiz', note,
            payload: JSON.stringify({ quelle: 'demo-history-repair', discardedByUser: true }) })
        }
      })
      reports.push({ tradeId: t.id, discarded: apply, previewDiscard: !apply })
      continue
    }
    if (!['geplant', 'aktiv'].includes(t.status)) { reports.push({ tradeId: t.id, terminal: true }); continue }
    const resolver = await createSymbolResolver(t.userId)
    const symbol = resolver(t.ticker, t.stockId)
    if (t.id === archiveId) {
      const fine = await readStoredCandles(symbol, '5min', { ascending: true, limit: 1 })
      if (!fine.length) throw new Error('Ende des Archivfensters ist nicht belegt.')
      const result = await repairDemoArchive(t.userId, t.id, fine[0].time, !apply)
      reports.push({ tradeId: t.id, archive: result })
    } else {
      const beginning = pruefBeginn(t, events.filter((e) => e.tradeId === t.id)).beginn
      const since = Math.floor(beginning.getTime() / 1000) - 86400
      const existing = await readStoredCandles(symbol, '5min', { ascending: true, limit: 1 })
      const end = Math.min(Date.now() / 1000, Math.max(existing[0]?.time ?? 0, since + 3 * 86400))
      const sourceSymbol = t.market === 'krypto' ? symbol.replace(/-USD$/, '/USD') : symbol
      const request = new URL('https://api.twelvedata.com/time_series')
      for (const [key, value] of Object.entries({ symbol: sourceSymbol, interval: '5min', timezone: 'UTC',
        start_date: new Date(since * 1000).toISOString().slice(0, 19).replace('T', ' '),
        end_date: new Date(end * 1000).toISOString().slice(0, 19).replace('T', ' '),
        outputsize: '5000', order: 'asc', apikey: process.env.TWELVEDATA_API_KEY ?? '' })) request.searchParams.set(key, value)
      const response = await fetch(request, { signal: AbortSignal.timeout(15000) })
      const series = await response.json()
      if (!response.ok || series.status !== 'ok' || series.meta?.symbol !== sourceSymbol || series.meta.interval !== '5min') {
        throw new Error(`Verifizierte Historie für ${t.ticker} fehlt (${response.status}, ${series.code ?? 'Format'}).`)
      }
      if (t.market === 'aktien' && (!['NASDAQ', 'NYSE'].includes(series.meta.exchange) || series.meta.currency !== 'USD')) {
        throw new Error('Aktie oder Handelsplatz ist nicht eindeutig bestätigt.')
      }
      const candles: Candle[] = series.values.map((v: Record<string, string>) => ({
        time: Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000,
        open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close), volume: Number(v.volume ?? 0),
      })).sort((a: Candle, b: Candle) => a.time - b.time)
      if (!candles.length || candles.some((c) => c.time % 300 !== 0 || ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) || c.high < c.low)) {
        throw new Error('Ungültige historische Kerzen.')
      }
      writeFileSync(`${directory}/${label}-${t.id}-source.json`, JSON.stringify({ source: 'twelvedata', symbol, meta: series.meta, candles }))
      if (apply) await withTradeLock(t.userId, t.id, async (current) => {
        if (!['geplant', 'aktiv'].includes(current.status)) throw new Error('Trade wurde zwischenzeitlich beendet.')
        if (current.stockId == null) {
          const [found] = await db.select({id:stock.id}).from(stock).where(and(eq(stock.userId, t.userId), eq(stock.providerSymbol, symbol), eq(stock.resolutionStatus, 'ok'))).limit(1)
          // Explicit columns also support installations with older optional watchlist fields.
          const instrument = found ?? (await db.execute(sql`INSERT INTO stock
            ("userId",name,ticker,market,"providerSymbol",provider,"resolutionStatus","resolvedName","resolvedExchange","resolvedCurrency","resolvedAt","resolutionNote")
            VALUES (${t.userId},${t.ticker},${t.ticker},${t.market},${symbol},'yahoo','ok',${t.ticker},${series.meta.exchange},${series.meta.currency},now(),
              'Historische Identität und Handelsplatz über Twelve Data bestätigt.') RETURNING id`)).rows[0] as { id: number }
          await db.update(trade).set({ stockId: instrument.id }).where(and(eq(trade.id, t.id), eq(trade.userId, t.userId)))
        }
        for (let i = 0; i < candles.length; i += 1000) await db.insert(candleCache)
          .values(candles.slice(i, i + 1000).map((c) => ({ ...c, symbol, interval: '5min' })))
          .onConflictDoNothing()
      })
      reports.push({ tradeId: t.id, fetched: candles.length, first: candles[0].time, last: candles.at(-1)!.time, applied: apply })
    }
    if (apply) {
      for (let page = 0; page < 80; page++) {
        const result = await runDemoFills({ userId: t.userId, tradeId: t.id, refresh: false })
        reports.push(result)
        if (result.error || result.ohneKerzen.length) throw new Error(`Reparatur für ${t.id} nicht vollständig: ${result.error ?? 'Kursdaten fehlen'}`)
        if (result.unvollstaendig.length) {
          if (t.id === archiveId) {
            const [current] = await db.select().from(trade).where(eq(trade.id, t.id))
            const from = Math.floor((current.demoCheckedAt ?? current.createdAt).getTime() / 900000) * 900
            const fine = await readStoredCandles(symbol, '5min', { since: from, ascending: true, limit: 4 })
            const next = fine.find((c) => c.time >= current.demoCheckedAt!.getTime() / 1000)
            if (!next) throw new Error('Ende der zusätzlichen Gold-Lücke ist nicht belegt.')
            const until = Math.ceil(next.time / 900) * 900
            const archive = (await yahooProvider.getCandles(symbol, '15min')).filter((c) => c.time >= from - 900 && c.time < until)
            if (!archive.length) throw new Error('Echtes Gold-Archiv fehlt.')
            writeFileSync(`${directory}/${label}-gold-${from}-archive.json`, JSON.stringify({ source: 'yahoo', symbol, interval: '15min', candles: archive }))
            await db.insert(candleCache).values(archive.map((c) => ({ ...c, symbol, interval: '15min' }))).onConflictDoNothing()
            reports.push({ tradeId: t.id, archive: await repairDemoArchive(t.userId, t.id, until, false) })
            continue
          }
          const [current] = await db.select().from(trade).where(eq(trade.id, t.id))
          const from = Math.floor((current.demoCheckedAt ?? current.openedAt ?? current.createdAt).getTime() / 1000) - 300
          const repaired = await refillGap(symbol, from, Math.min(Date.now() / 1000, from + 86400))
          reports.push({ tradeId: t.id, gapRefill: repaired })
          continue
        }
        if (!result.ausstehend.length) break
        if (page === 79) throw new Error('Reparatur überschreitet Seitenlimit.')
      }
    }
  }
  const finalTrades = await db.select().from(trade).where(inArray(trade.id, ids))
  const finalEvents = await db.select().from(tradeEvent).where(inArray(tradeEvent.tradeId, ids))
  writeFileSync(`${directory}/${label}-after.json`, JSON.stringify({ trades: finalTrades, events: finalEvents, reports }, null, 2))
  console.log(JSON.stringify({ apply, reports, trades: finalTrades.map((t) => ({ id: t.id, ticker: t.ticker, status: t.status, issue: t.demoIssue })) }))
} finally { await pool.end() }

}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
