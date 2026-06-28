import {
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  integer,
  doublePrecision,
} from 'drizzle-orm/pg-core'

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// --- App tables ------------------------------------------------------------

// One row per instrument (stock/crypto/forex…). The shared aggregation key:
// both pure analyses (assessment) and real trades (trade) reference it.
// Table name stays `stock` for backwards compatibility; surfaced as "Instrument" in the UI.
export const stock = pgTable('stock', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  ticker: text('ticker').notNull(),
  // aktien | krypto | forex | rohstoffe | etf | optionen | sonstiges
  market: text('market').notNull().default('aktien'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// One row per individual analysis result (correct or wrong) — a PURE prediction
// without a real position. The time series powers the hit-rate-over-time chart.
export const assessment = pgTable('assessment', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  stockId: integer('stockId').notNull(),
  isCorrect: boolean('isCorrect').notNull(),
  note: text('note'),
  // Elliott / Douglas enrichment (optional)
  predictedDirection: text('predictedDirection'), // long | short
  elliottCount: text('elliottCount'), // freie Wellenzählung
  assessmentDate: timestamp('assessmentDate').notNull().defaultNow(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// One row per REAL planned trade (ported from DisciplinedTrader's TradePlan).
// Carries the Douglas discipline layer + full Elliott fields.
// Lifecycle: geplant → aktiv → abgeschlossen | abgebrochen.
export const trade = pgTable('trade', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  // optional link to an instrument in the watchlist (shared hit-rate key)
  stockId: integer('stockId'),
  ticker: text('ticker').notNull(),
  market: text('market').notNull().default('aktien'),

  // --- Plan (locked once status = aktiv) ---
  direction: text('direction').notNull(), // long | short
  entryPrice: doublePrecision('entryPrice').notNull(),
  stopLoss: doublePrecision('stopLoss').notNull(),
  takeProfit: doublePrecision('takeProfit'),
  positionSize: doublePrecision('positionSize'),
  strategy: text('strategy'),
  broker: text('broker'),
  riskRewardRatio: doublePrecision('riskRewardRatio'),
  notes: text('notes'),
  status: text('status').notNull().default('geplant'),

  // --- Elliott (voll integriert) ---
  elliottWaveCount: text('elliottWaveCount'),
  waveDegree: text('waveDegree'), // deutsche Wellengrad-Notation
  elliottInvalidation: doublePrecision('elliottInvalidation'), // "Analyse ungültig"-Preis

  // --- Douglas discipline ---
  preTradeAnswered: boolean('preTradeAnswered').notNull().default(false), // 4-Fragen-Gate (= alle 4 = ja)
  // JSON array der 4 Antworten: [{ key, question, answer: 'ja'|'nein', note }]
  preTradeAnswers: text('preTradeAnswers'),
  // mit echtem Geld gehandelt vs. Demo/Papertrade
  tradedWithMoney: boolean('tradedWithMoney').notNull().default(true),
  followedPlan: boolean('followedPlan'),
  // JSON array of flags: stop_moved | invalidation_ignored | revenge
  ruleViolations: text('ruleViolations'),
  lossAccepted: boolean('lossAccepted').notNull().default(false),

  // --- Outcome ---
  result: text('result'), // gewinn | verlust | breakeven
  actualExitPrice: doublePrecision('actualExitPrice'),

  // --- Timestamps (Revenge-Guard) ---
  openedAt: timestamp('openedAt'),
  closedAt: timestamp('closedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})
