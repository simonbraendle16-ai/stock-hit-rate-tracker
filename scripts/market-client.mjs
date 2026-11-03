import { Client } from 'pg'
import { marketLocation, MARKET_POOL_OPTIONS } from '../lib/market-data/location.mjs'

/** Explicit two-store maintenance client. Cross-store SQL is rejected.
 * BEGIN/COMMIT protect market writes only; core reads remain independent.
 * Callers must not claim a shared snapshot or distributed transaction. */
export class MarketMaintenanceClient {
  constructor(options = {}) {
    this.location=marketLocation()
    this.core=new Client({ ...MARKET_POOL_OPTIONS,...options,connectionString:process.env.DATABASE_URL })
    this.market=this.location.location==='A'?this.core:new Client({ ...MARKET_POOL_OPTIONS,connectionString:this.location.connectionString })
    this.marketConnected=false
  }
  async connect() { await this.core.connect(); if(this.market===this.core)this.marketConnected=true }
  async query(text,values) {
    const market=/\bcandle_(?:cache|series|collect_run)\b/i.test(text)
    const personal=/\b(?:from|join|update|into)\s+"?(?:stock|trade|assessment|training_session|quote_snapshot|trade_event|broker_order)\b/i.test(text)
    if(market&&personal)throw new Error('Gemischtes SQL über A/B ist nicht erlaubt.')
    const control=/^\s*(?:begin|commit|rollback|set\b)/i.test(text)
    const client=market||control?this.market:this.core
    if(client===this.market&&!this.marketConnected){await client.connect();this.marketConnected=true}
    return client.query(text,values)
  }
  async end(){await Promise.allSettled([this.core.end(),...(this.market!==this.core?[this.market.end()]:[])])}
}
