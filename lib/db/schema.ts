import {
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  integer,
  doublePrecision,
  primaryKey,
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

// Pro-User-Einstellungen: Startkapital & Risiko-Vorgaben. Grundlage für die
// echten Geld-Kennzahlen (Bilanz, Rendite) und den Risiko-Guard im Formular.
export const userSettings = pgTable('user_settings', {
  userId: text('userId').primaryKey(),
  startCapital: doublePrecision('startCapital').notNull().default(10000),
  defaultRiskPct: doublePrecision('defaultRiskPct').notNull().default(1),
  maxRiskPct: doublePrecision('maxRiskPct').notNull().default(2),
  // Kontowährung — reine Anzeige-/Formatierungsebene. Kurse notieren weiterhin
  // in der Währung des Instruments und werden NICHT umgerechnet.
  currency: text('currency').notNull().default('EUR'),
  // Vorbelegung der Ordergebühr im Trade-Formular; pro Trade überschreibbar.
  defaultFeeEntry: doublePrecision('defaultFeeEntry').notNull().default(9),
  defaultFeeExit: doublePrecision('defaultFeeExit').notNull().default(9),
})

// Ein- und Auszahlungen aufs Handelskonto. Ohne sie rechnet die Rendite gegen
// ein fixes Startkapital und wird ab der ersten Nachzahlung falsch.
export const cashflow = pgTable('cashflow', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  // immer positiv; die Richtung steckt in `kind`
  amount: doublePrecision('amount').notNull(),
  kind: text('kind').notNull().default('einzahlung'), // einzahlung | auszahlung
  occurredAt: timestamp('occurredAt').notNull().defaultNow(),
  note: text('note'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

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
  // optionaler Link zum Chart (z. B. TradingView), um ihn direkt aufzurufen
  chartUrl: text('chartUrl'),
  // Watchlist V2: benutzerdefinierte Sektion (TradingView-Stil-Gruppen) + Sortierung
  watchlistSection: text('watchlistSection'),
  sortOrder: integer('sortOrder').notNull().default(0),
  // Etappe 9 „Symbolauflösung": `ticker` bleibt, was der Nutzer eingetippt hat
  // (und die Verknüpfung zu den Trades); daneben steht das beim Anbieter
  // tatsächlich existierende Symbol. Erst diese Trennung erlaubt „CL1!" in der
  // Oberfläche und „CL=F" in der Abfrage.
  providerSymbol: text('providerSymbol'),
  // yahoo | twelvedata | binance
  provider: text('provider'),
  // ok | ambiguous | unresolved — NULL heißt „noch nie versucht".
  resolutionStatus: text('resolutionStatus'),
  resolutionConfidence: integer('resolutionConfidence'),
  // Was der Anbieter zum Symbol sagt — damit der Nutzer prüfen kann, ob wirklich
  // sein Wert gemeint ist.
  resolvedName: text('resolvedName'),
  resolvedExchange: text('resolvedExchange'),
  resolvedCurrency: text('resolvedCurrency'),
  resolutionNote: text('resolutionNote'),
  // Geprüfte Alternativen als JSON-Array (siehe `ResolutionCandidate`).
  resolutionCandidates: text('resolutionCandidates'),
  // Von Hand gesetzt → die Automatik fasst es nie wieder an.
  resolutionPinned: boolean('resolutionPinned').notNull().default(false),
  // Näherung statt Entsprechung (z. B. Gold-Future statt Spot).
  resolutionApproximate: boolean('resolutionApproximate').notNull().default(false),
  resolvedAt: timestamp('resolvedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Etappe 9: dauerhafter Kursspeicher, Schlüssel ist das ANBIETER-Symbol, nicht
// das Instrument — dasselbe Papier in mehreren Watchlists wird einmal abgefragt.
// Die Oberfläche liest ausschließlich hier, nie direkt beim Anbieter; gefüllt
// wird gebündelt vom Synchronisierungslauf. Dadurch überlebt die Anzeige einen
// Anbieterausfall mit dem letzten bekannten Kurs statt mit einem leeren Feld.
export const quoteSnapshot = pgTable(
  'quote_snapshot',
  {
    provider: text('provider').notNull(),
    symbol: text('symbol').notNull(),
    price: doublePrecision('price').notNull(),
    previousClose: doublePrecision('previousClose'),
    changePct: doublePrecision('changePct'),
    currency: text('currency'),
    exchange: text('exchange'),
    name: text('name'),
    // Kursstand beim Anbieter (Unix-Sekunden) — Grundlage für „Kurs von 14:32".
    quotedAt: integer('quotedAt').notNull(),
    // Zeitpunkt unseres Abrufs. Differenz zeigt geschlossenen Markt vs. Hänger.
    // MIT Zeitzone (Migration 0021): Aus diesem Wert wird gerechnet („ist der
    // Kurs zu alt?"). Eine Spalte ohne Zeitzone speichert nur eine Wanduhrzeit
    // und war beim Zurücklesen um den Serverversatz daneben — die Kurse galten
    // dadurch immer als zwei Stunden alt.
    fetchedAt: timestamp('fetchedAt', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('lastError'),
    failCount: integer('failCount').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.symbol] })],
)

// Etappe 9: Protokoll der Synchronisierungsläufe. Die Anforderung war, nicht
// mehr nachhaken zu müssen — ohne Protokoll ließe sich nur vermuten, ob die
// Automatik läuft.
export const symbolSyncRun = pgTable('symbol_sync_run', {
  id: serial('id').primaryKey(),
  // Ebenfalls mit Zeitzone (Migration 0021) — siehe `quote_snapshot.fetchedAt`.
  startedAt: timestamp('startedAt', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finishedAt', { withTimezone: true }),
  // cron | manual | onload
  trigger: text('trigger').notNull().default('cron'),
  symbolsTotal: integer('symbolsTotal').notNull().default(0),
  quotesUpdated: integer('quotesUpdated').notNull().default(0),
  resolvedNew: integer('resolvedNew').notNull().default(0),
  stillUnresolved: integer('stillUnresolved').notNull().default(0),
  error: text('error'),
})

// One row per individual analysis result (correct or wrong) — a PURE prediction
// without a real position. The time series powers the hit-rate-over-time chart.
export const assessment = pgTable('assessment', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  stockId: integer('stockId').notNull(),
  isCorrect: boolean('isCorrect').notNull(),
  // neutral: Zielzone nie angelaufen → weder richtig noch falsch (isCorrect ignoriert)
  zoneNotReached: boolean('zoneNotReached').notNull().default(false),
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
  // Erfassungsweg (Migration 0018): 'langfristig' = voller Weg mit Fragen-Gate,
  // 'schnell' = nur das Nötigste, Gate und Check-in entfallen. An diesem Feld
  // hängen zwei Guard-Entscheidungen — die Regeln stehen in lib/trade-kind.ts.
  tradeKind: text('tradeKind').notNull().default('langfristig'),

  // --- Plan (locked once status = aktiv) ---
  direction: text('direction').notNull(), // long | short
  entryPrice: doublePrecision('entryPrice').notNull(),
  stopLoss: doublePrecision('stopLoss').notNull(),
  takeProfit: doublePrecision('takeProfit'),
  positionSize: doublePrecision('positionSize'),
  // Kapitaleinsatz in Kontowährung (Echtgeld); die Stückzahl in positionSize
  // wird daraus abgeleitet — bei Hebel aus Einsatz × Hebel.
  investedAmount: doublePrecision('investedAmount'),
  // Hebel je Trade, 1 = ungehebelt. Steckt bereits in positionSize und wirkt
  // dadurch automatisch in Risiko, P&L und Risiko-Guard mit.
  leverage: doublePrecision('leverage').notNull().default(1),
  // Tatsächlich gezahlte Ordergebühren, beim Abschluss eingefroren. Vorher aus
  // einer Konstante zur Laufzeit gerechnet — eine Änderung der Standard-Gebühr
  // hätte damit rückwirkend die gesamte Historie verschoben.
  feeEntry: doublePrecision('feeEntry'),
  feeExit: doublePrecision('feeExit'),
  // Verkaufsanteil beim Take-Profit in Prozent (Teilverkauf-Projektion), Standard 100.
  takeProfitPct: doublePrecision('takeProfitPct').default(100),
  strategy: text('strategy'),
  // Setup-Tags (Etappe 7b): kurze, vergleichbare Schubladen als JSON-Array —
  // die auswertbare Ergänzung zum Freitext daneben, der die Begründung bleibt.
  // Null = Alt-Trade ohne Tags; die Auswertung zählt ihn als „ohne Angabe".
  // Normalisierung und Grenzen in `lib/setups.ts`.
  setupTags: text('setupTags'),
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

  // --- Emotions-Check-in (Etappe 4) ---
  // Zwei Momentaufnahmen: beim Aktivieren und beim Abschließen. Skala 1-5
  // (ruhig ↔ aufgewühlt), Tags als JSON-Array aus der festen Liste in
  // `lib/emotions.ts`. Null = Alt-Trade ohne Check-in; die Auswertung zählt
  // solche Zeilen als „ohne Angabe" statt sie zu erfinden.
  moodEntry: integer('moodEntry'),
  moodEntryTags: text('moodEntryTags'),
  moodEntryNote: text('moodEntryNote'),
  moodExit: integer('moodExit'),
  moodExitTags: text('moodExitTags'),
  moodExitNote: text('moodExitNote'),

  // --- Outcome ---
  result: text('result'), // gewinn | verlust | breakeven
  actualExitPrice: doublePrecision('actualExitPrice'),
  // optionale Begründung, wenn status = 'kein_handel' (Zielzone nicht angelaufen)
  noTradeNote: text('noTradeNote'),

  // --- Timestamps (Revenge-Guard) ---
  openedAt: timestamp('openedAt'),
  closedAt: timestamp('closedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Kurs-Alerts (Etappe 3): ein vom Nutzer gesetztes Preislevel, das beim Laden
// der Kerzen gegen den aktuellen Kurs geprüft wird. Das Symbol (ticker/market)
// steht eigenständig auf der Zeile, damit der Kursabruf ohne Join funktioniert —
// ein Trade kann ohne verknüpftes Instrument (stockId) existieren.
export const priceAlert = pgTable('price_alert', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  // optionaler Bezug auf Watchlist-Instrument bzw. auslösenden Trade
  stockId: integer('stockId'),
  tradeId: integer('tradeId'),
  ticker: text('ticker').notNull(),
  market: text('market').notNull().default('aktien'),
  // zu erreichendes Kurslevel
  price: doublePrecision('price').notNull(),
  // Kreuzungsrichtung: 'above' (Kurs steigt bis/über) | 'below' (fällt bis/unter)
  direction: text('direction').notNull(),
  // Herkunft: 'einstieg' | 'stop' | 'ziel' (aus dem Plan) | 'manuell'
  kind: text('kind').notNull().default('manuell'),
  note: text('note'),
  // aktiv & nicht ausgelöst → wird bei jedem Kursabruf geprüft
  active: boolean('active').notNull().default(true),
  // Auslösezeitpunkt; null = noch nicht erreicht
  triggeredAt: timestamp('triggeredAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Persistente Chart-Zeichnungen (Trendlinien, Fibs, Level, Notizen) je Instrument.
export const chartDrawing = pgTable('chart_drawing', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  stockId: integer('stockId').notNull(),
  // hline | trendline | fib | text
  type: text('type').notNull(),
  // JSON array von Punkten: [{ time (Unix-Sek.), price }]; bei text zusätzlich { text }
  points: text('points').notNull(),
  // JSON: { color?, dashed?, label? }
  style: text('style'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Freunde (Etappe 2): gegenseitige Accountability. Eine Freundschaft ist eine
// Zeile; für beide Seiten gilt dieselbe feste Stufe (Disziplin-Kennzahlen +
// abgeschlossene Trades in R-Vielfachen, nie Beträge). Trades werden erst nach
// Abschluss sichtbar — kein Copy-Trading. Entstehung nur per Einladungscode.
export const friendship = pgTable('friendship', {
  id: serial('id').primaryKey(),
  requesterId: text('requesterId').notNull(),
  addresseeId: text('addresseeId').notNull(),
  // offen | angenommen | abgelehnt
  status: text('status').notNull().default('angenommen'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  respondedAt: timestamp('respondedAt'),
})

// Einladungscode statt E-Mail-Versand (lib/auth.ts hat keinen Mailer). Der
// Ersteller erzeugt einen Code, gibt ihn über einen beliebigen Kanal weiter,
// der andere löst ihn ein → daraus entsteht die gegenseitige Freundschaft.
export const inviteCode = pgTable('invite_code', {
  code: text('code').primaryKey(),
  userId: text('userId').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  expiresAt: timestamp('expiresAt').notNull(),
  usedByUserId: text('usedByUserId'),
})

// Event-Log (Etappe 6): jede Veränderung eines Trades als eigenes Ereignis —
// Eröffnung, Teilverkauf, Nachkauf, Stop-/Ziel-Verschiebung, Notiz, Abschluss.
// Daraus entsteht die lesbare Chronik auf der Trade-Detailseite und die Basis für
// echte Teilverkäufe (gewichteter Durchschnitt, realisiert vs. unrealisiert).
// userId steht eigenständig neben tradeId (wie bei price_alert), damit die
// Event-Abfrage ohne Join auf "trade" auskommt. Kein Backfill: Alt-Trades leiten
// ihre Timeline zur Anzeigezeit aus vorhandenen Feldern ab.
export const tradeEvent = pgTable('trade_event', {
  id: serial('id').primaryKey(),
  tradeId: integer('tradeId').notNull(),
  userId: text('userId').notNull(),
  // eroeffnet | teilverkauf | nachkauf | stop_verschoben | ziel_geaendert |
  // invalidation_ignoriert | notiz | geschlossen (feste Liste in lib/trade-events.ts)
  type: text('type').notNull(),
  // fachlicher Zeitpunkt des Ereignisses; createdAt = technischer Schreibzeitpunkt
  at: timestamp('at').notNull().defaultNow(),
  // nur bei teilverkauf/nachkauf: Stückzahl, Ausführungskurs, anteilige Gebühr
  quantity: doublePrecision('quantity'),
  price: doublePrecision('price'),
  fee: doublePrecision('fee'),
  // JSON für Level-Ereignisse: { from, to }
  payload: text('payload'),
  note: text('note'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Bot-Zwilling (Etappe 5): von Hand nachgetragener Ausgang eines Trades, den die
// Simulation nicht rechnen kann (keine Historie, unbekannter Ticker, Gratis-Limit).
// Die Simulation selbst speichert NICHTS — sie rechnet live über die Kerzen. Diese
// Tabelle füllt nur die Lücken, und ihre Zeilen werden in der Auswertung sichtbar
// als „nachgetragen" gekennzeichnet. Liegen später doch Kerzen vor, gewinnt das
// simulierte Ergebnis: eine Handeingabe überstimmt keine Messung.
export const botManualOutcome = pgTable('bot_manual_outcome', {
  id: serial('id').primaryKey(),
  tradeId: integer('tradeId').notNull(),
  userId: text('userId').notNull(),
  // ziel | stop | offen (feste Liste in lib/bot-twin.ts → BotOutcome)
  outcome: text('outcome').notNull(),
  // nur bei 'offen' nötig; bei ziel/stop ergibt sich der Kurs aus dem Plan
  exitPrice: doublePrecision('exitPrice'),
  note: text('note'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// MAE/MFE (Etappe 7c): von Hand nachgetragene Extremkurse der Haltedauer.
// Gemessen wird über die Kerzen (lib/excursion.ts, speichert nichts); diese
// Tabelle füllt nur die Lücken — fehlende Kursdaten oder eine Kerze, die länger
// ist als der ganze Trade und damit gar nicht das Haltefenster misst.
// Gespeichert werden KURSE, nie R-Werte: das R ergibt sich aus Einstieg und
// Stopdistanz. Vorrang hat die Messung, außer sie ist grob (siehe `resolveRun`).
export const tradeExcursion = pgTable('trade_excursion', {
  id: serial('id').primaryKey(),
  tradeId: integer('tradeId').notNull(),
  userId: text('userId').notNull(),
  // Tiefster Punkt gegen die Position (MAE) …
  worstPrice: doublePrecision('worstPrice'),
  // … und höchster für sie (MFE). Eine fehlende Seite gilt als „nicht gelaufen".
  bestPrice: doublePrecision('bestPrice'),
  note: text('note'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})
