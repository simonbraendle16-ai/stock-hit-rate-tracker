/** Server-only, immutable deployment mapping. No per-request or random routing. */
/** @param {Record<string, string | undefined>} env */
export function marketLocation(env = process.env) {
  const version = env.MARKET_DATA_ROUTING_VERSION || 'legacy'
  const location = env.MARKET_DATA_LOCATION || 'A'
  if (!['legacy', '1'].includes(version) || !['A', 'B'].includes(location) || version === 'legacy' && location !== 'A')
    throw new Error('Ungültige Marktdatenzuordnung.')
  if (location === 'B') {
    if (!env.MARKET_DATABASE_URL) throw new Error('Marktdatenziel B fehlt.')
    // URL parser errors can contain their input, including a credential. Sanitize.
    let target,source
    try { target=new URL(env.MARKET_DATABASE_URL);source=new URL(env.DATABASE_URL || '') }
    catch { throw new Error('Ungültige serverseitige Datenbankkonfiguration.') }
    if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Ungültiges Marktdatenziel.')
    if (env.DATABASE_URL) {
      const host = value => ['localhost','127.0.0.1','[::1]'].includes(value) ? 'loopback' : value.replace('-pooler', '')
      if (host(source.hostname) === host(target.hostname) && (source.port || '5432') === (target.port || '5432') && source.pathname === target.pathname)
        throw new Error('Marktdatenziel muss von A getrennt sein.')
    }
  }
  return Object.freeze({ version, location, connectionString: location === 'B' ? env.MARKET_DATABASE_URL : env.DATABASE_URL })
}
export const MARKET_POOL_OPTIONS = Object.freeze({ max: 3, connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 10000, statement_timeout: 4000, query_timeout: 5000,
  idle_in_transaction_session_timeout: 5000, application_name: 'tracker-market-v1' })
