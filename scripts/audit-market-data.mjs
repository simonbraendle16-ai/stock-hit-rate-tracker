import { Client, types } from 'pg'

// App timestamps are written as UTC. Match the server interpretation on Windows too.
types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'))

// Read-only owner-scoped inventory. Never emits credentials, names or prices.
const anchor = Number(process.argv[2])
if (!Number.isSafeInteger(anchor) || anchor <= 0) throw new Error('Anker-Trade-ID erforderlich.')
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, statement_timeout: 15000 })
try {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const owner = await client.query('SELECT "userId" FROM trade WHERE id=$1', [anchor])
  if (owner.rowCount !== 1) throw new Error('Anker nicht eindeutig.')
  const userId = owner.rows[0].userId
  const instruments = await client.query(`SELECT s.id,s.ticker,s.market,s."providerSymbol",s.provider,
    s."resolutionStatus",s."resolutionApproximate",s."resolvedName",s."resolvedExchange",s."resolvedCurrency",
    q."quotedAt",q."fetchedAt" AS "quoteFetchedAt",q."lastError" AS "quoteError",q."failCount" AS "quoteFailures",
    c."firstTime",c."lastTime",c."candleCount",c."fetchedAt" AS "candleFetchedAt",c."lastError" AS "candleError"
    FROM stock s LEFT JOIN quote_snapshot q ON q.symbol=s."providerSymbol" AND q.provider=s.provider
    LEFT JOIN candle_series c ON c.symbol=s."providerSymbol" AND c.interval='5min'
    WHERE s."userId"=$1 ORDER BY s.id`, [userId])
  const trades = await client.query(`SELECT t.id,t.ticker,t.market,t.status,t.version,t."stockId",
    t."quoteCurrency",t."accountCurrency",t."quoteToAccountRate",t."fxRateAt",t."demoIssue",t."demoCheckedAt",
    s.market AS "instrumentMarket",s."providerSymbol",s."resolutionApproximate",
    (SELECT count(*)::int FROM trade_event e WHERE e."tradeId"=t.id AND e."userId"=t."userId") AS "eventCount",
    (SELECT count(*)::int FROM broker_order b WHERE b."linkedTradeId"=t.id AND b."userId"=t."userId") AS "brokerLinks"
    FROM trade t LEFT JOIN stock s ON s.id=t."stockId" AND s."userId"=t."userId"
    WHERE t."userId"=$1 ORDER BY t.id`, [userId])
  const history = await client.query(`SELECT e."tradeId",e.type,e.at,e.payload FROM trade_event e
    JOIN trade t ON t.id=e."tradeId" AND t."userId"=e."userId"
    WHERE t."userId"=$1 AND (t."quoteCurrency" IS NULL OR t."accountCurrency" IS NULL OR t."quoteToAccountRate" IS NULL)
    ORDER BY e."tradeId",e.at`, [userId])
  const currencyEvidence = history.rows.map(e => {
    let p; try { p = JSON.parse(e.payload ?? '{}') } catch { p = {} }
    // Record whether explicit frozen currency fields exist, without notes/prices.
    const keys = []
    const visit = (value, prefix = '') => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        const name = prefix + key
        if (/currency|fx|rate/i.test(key) && child != null) keys.push(name)
        if (child && typeof child === 'object') visit(child, name + '.')
      }
    }
    visit(p)
    return { tradeId: e.tradeId, type: e.type, at: e.at, currencyKeys: keys }
  })
  const legacy = trades.rows.filter(t => !t.quoteCurrency || !t.accountCurrency || !t.quoteToAccountRate)
  console.log(JSON.stringify({ at: new Date().toISOString(), readOnly: true,
    summary: { instruments: instruments.rowCount, trades: trades.rowCount,
      unlinked: trades.rows.filter(t => !t.stockId).map(t => t.id),
      marketMismatch: trades.rows.filter(t => t.stockId && t.market !== t.instrumentMarket).map(t => t.id),
      legacyCurrency: legacy.map(t => t.id) }, instruments: instruments.rows, trades: trades.rows, currencyEvidence }, null, 2))
} finally {
  await client.query('ROLLBACK').catch(() => {})
  await client.end()
}
