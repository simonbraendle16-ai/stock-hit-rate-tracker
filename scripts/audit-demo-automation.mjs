import { Client } from 'pg'

// Read-only evidence; no prices, quantities, notes, credentials or raw payloads.
const anchor = Number(process.argv[2])
if (!Number.isSafeInteger(anchor) || anchor <= 0) throw new Error('Anker-Trade-ID erforderlich.')
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, statement_timeout: 15000 })
try {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const owner = await client.query('SELECT "userId" FROM trade WHERE id=$1', [anchor])
  if (owner.rowCount !== 1) throw new Error('Anker nicht eindeutig.')
  const userId = owner.rows[0].userId
  const trades = await client.query(`SELECT t.id,t.ticker,t.status,t."tradeKind",t.version,t."demoIssue",t."demoCheckedAt",
    t."demoBoundaryAt",t."planContext",t."elliottInvalidation" IS NOT NULL AS "invalidationPresent",
    t."positionSize">0 AS "quantityPresent",t."quoteCurrency",t."accountCurrency",
    t."quoteToAccountRate">0 AS "fxPresent",t."fxRateAt" IS NOT NULL AS "fxDatePresent",
    t."entryPrice">0 AS "entryPresent",t."stopLoss">0 AS "stopPresent",t."takeProfit">0 AS "targetPresent",
    s.id AS "instrumentId",s.market=t.market AS "marketMatches",s."providerSymbol",s.provider,
    s."resolutionStatus",s."resolutionApproximate",
    EXISTS(SELECT 1 FROM broker_order b WHERE b."linkedTradeId"=t.id AND b."userId"=t."userId") AS "brokerLinked"
    FROM trade t JOIN portfolio p ON p.id=t."portfolioId" AND p."userId"=t."userId"
    LEFT JOIN stock s ON s.id=t."stockId" AND s."userId"=t."userId"
    WHERE t."userId"=$1 AND p.kind='demo' ORDER BY t.id`, [userId])
  const entries = trades.rows.map(({ planContext: c, ...t }) => ({ ...t,
    planFields: { expectedMove: Boolean(c?.expectedMove), entryTrigger: Boolean(c?.entryTrigger),
      stopManagement: Boolean(c?.stopManagement), targetManagement: Boolean(c?.targetManagement),
      riskConfirmed: c?.riskConfirmed === true } }))
  const events = await client.query(`SELECT e."tradeId",e.type,e.at,e.payload FROM trade_event e
    JOIN trade t ON t.id=e."tradeId" AND t."userId"=e."userId"
    JOIN portfolio p ON p.id=t."portfolioId" AND p."userId"=t."userId"
    WHERE t."userId"=$1 AND p.kind='demo' ORDER BY e.at,e.id`, [userId])
  const automaticEvents = events.rows.flatMap(({ payload, ...e }) => {
    let p; try { p = JSON.parse(payload ?? '{}') } catch { return [] }
    return p.quelle === 'demo-fill' ? [{ ...e, art: p.art, interval: p.interval,
      historical: p.historisch === true, sourceRecorded: Boolean(p.kursquelle) }] : []
  })
  const schedule = await client.query('SELECT id,"nextRunAt","leaseUntil" FROM demo_run_state')
  console.log(JSON.stringify({ at: new Date().toISOString(), readOnly: true, trades: entries,
    automaticEvents, schedule: schedule.rows }, null, 2))
} finally {
  await client.query('ROLLBACK').catch(() => {})
  await client.end()
}
