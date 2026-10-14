/** The current provider explicitly confirms a pause of its regular-session feed.
 * Never use an old closing price to trigger an alarm, or infer a pause from age alone.
 */
export function confirmedRegularFeedPause(snapshot: {
  price: number; quotedAt: number; fetchedAt: Date; marketState: string | null
  quoteType: string | null; exchange: string | null; lastError: string | null
}, market: string, now = Date.now()): boolean {
  const age = now - snapshot.fetchedAt.getTime(), quoteAge = now - snapshot.quotedAt * 1000
  if (!['aktien', 'etf'].includes(market) || !['EQUITY', 'ETF'].includes(snapshot.quoteType ?? '')
    || !Number.isFinite(snapshot.price) || snapshot.price <= 0
    || !Number.isFinite(age) || age < 0 || age > 15 * 60_000
    || !Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 5 * 86400_000 || snapshot.lastError) return false
  const venue = snapshot.exchange?.toUpperCase() ?? ''
  const config = ['NASDAQGS', 'NASDAQGM', 'NASDAQCM', 'NASDAQ', 'NYSE', 'NMS', 'NGM', 'NCM', 'NYQ', 'NYS', 'XNGS', 'XNYS'].includes(venue)
    ? { zone: 'America/New_York', open: 570, close: 960 }
    : venue === 'ASX' ? { zone: 'Australia/Sydney', open: 600, close: 972 }
      : ['XETRA', 'GER', 'XETR'].includes(venue) ? { zone: 'Europe/Berlin', open: 540, close: 1050 } : null
  if (!config) return false
  // CLOSED is explicit provider evidence, including an exchange holiday.
  if (snapshot.marketState === 'CLOSED') return true
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: config.zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map(p => [p.type, p.value]))
  if (['Sat', 'Sun'].includes(parts.weekday)) return false
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  // A cached PRE/POST status cannot excuse missing prices after the next open.
  return (snapshot.marketState === 'PRE' || snapshot.marketState === 'PREPRE') && minutes < config.open
    || (snapshot.marketState === 'POST' || snapshot.marketState === 'POSTPOST') && (minutes >= config.close || minutes < config.open)
}
