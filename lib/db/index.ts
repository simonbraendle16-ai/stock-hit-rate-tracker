import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Die Verbindung — Supabase zuerst, `DATABASE_URL` nur noch als Rückfall.
 *
 * Warum zwei Namen: Auf Vercel gehört `DATABASE_URL` der Neon-Marketplace-
 * Integration. Sie hat am 26.06.2026 einen ganzen Block Variablen angelegt
 * (`POSTGRES_*`, `PG*`, `NEON_PROJECT_ID`) und speist sie bei jedem Sync neu
 * ein — ein von Hand gesetzter Supabase-Wert wäre dort nicht verlässlich.
 *
 * Die Integration einfach zu entfernen ist bis auf Weiteres KEINE Option: Beim
 * Entfernen einer Marketplace-Integration wird in der Regel auch die
 * bereitgestellte Ressource gelöscht — hier das Neon-Projekt mit den echten
 * Trades, die erst ab dem 01.09.2026 abholbar sind. Erst danach darf die
 * Integration weg, und dann kann auch dieser Rückfall wieder verschwinden.
 */
const connectionString = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL

export const pool = new Pool({ connectionString })
export const db = drizzle(pool, { schema })
