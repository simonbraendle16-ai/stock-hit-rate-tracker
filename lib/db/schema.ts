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

// Depot (Etappe 12). Der Ort, in den gebucht wird — und die Quelle der
// Handelsart: `kind` bestimmt, ob die Trades darin echtes Geld bewegen.
//
// Warum ein Ort und kein Formularfeld: Die Handelsart war bis hierher ein
// Umschalter mit Vorbelegung „Echtgeld". Ein vergessener Klick, und ein
// Papier-Trade zählte als echt — genau das ist passiert. Ein Depot weiß, was es
// ist; `trade.tradedWithMoney` ist ab jetzt nur noch die abgeleitete
// Schreibweise davon (gesetzt ausschließlich in `createTrade` und `moveTrade`).
//
// Heißt `portfolio` und nicht `account`, weil `account` Better Auth gehört.
// In der Oberfläche durchgehend „Depot".
export const portfolio = pgTable('portfolio', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  // echtgeld | demo — unveränderlich, sobald Trades daranhängen (das würde die
  // Bilanz rückwirkend umschreiben). Regel in `lib/portfolio-scope.ts`.
  kind: text('kind').notNull().default('echtgeld'),
  // Eigenes Startkapital je Depot; beim Demo-Depot das Papier-Startkapital.
  // Nur damit hat die Übung eine eigene Bilanz — und nur dann sind
  // Prozentzahlen zwischen Übung und Ernst vergleichbar.
  startCapital: doublePrecision('startCapital').notNull().default(10000),
  // Gebühren-Vorbelegung je Depot (verschiedene Broker kosten verschieden);
  // im Demo-Depot 0, denn Papier kostet nichts (siehe `tradeFees`).
  defaultFeeEntry: doublePrecision('defaultFeeEntry').notNull().default(9),
  defaultFeeExit: doublePrecision('defaultFeeExit').notNull().default(9),
  sortOrder: integer('sortOrder').notNull().default(0),
  // Stillgelegt: fällt aus Umschalter und Echtgeld-Aggregat, Historie bleibt
  // lesbar. Ein befülltes Depot wird nie gelöscht, nur archiviert.
  archivedAt: timestamp('archivedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Pro-User-Einstellungen: Risiko-Vorgaben, Währung und die aktive Depot-Auswahl.
//
// `startCapital` und `defaultFee*` stehen seit Etappe 12 am DEPOT und werden
// hier nicht mehr gelesen. Die Spalten bleiben absichtlich stehen (die Migration
// ist additiv und damit umkehrbar) — wer sie ausliest, bekommt einen veralteten
// Wert. Quelle ist `portfolio`.
export const userSettings = pgTable('user_settings', {
  userId: text('userId').primaryKey(),
  /** @deprecated seit Etappe 12 — steht am Depot (`portfolio.startCapital`). */
  startCapital: doublePrecision('startCapital').notNull().default(10000),
  defaultRiskPct: doublePrecision('defaultRiskPct').notNull().default(1),
  maxRiskPct: doublePrecision('maxRiskPct').notNull().default(2),
  // Kontowährung — reine Anzeige-/Formatierungsebene. Kurse notieren weiterhin
  // in der Währung des Instruments und werden NICHT umgerechnet. Bleibt
  // bewusst GLOBAL: Ein Aggregat über Depots verschiedener Währung wäre keine
  // gültige Summe, weil die App nicht umrechnet.
  currency: text('currency').notNull().default('EUR'),
  /** @deprecated seit Etappe 12 — steht am Depot (`portfolio.defaultFeeEntry`). */
  defaultFeeEntry: doublePrecision('defaultFeeEntry').notNull().default(9),
  /** @deprecated seit Etappe 12 — steht am Depot (`portfolio.defaultFeeExit`). */
  defaultFeeExit: doublePrecision('defaultFeeExit').notNull().default(9),
  // Aktive Auswahl: 'echtgeld' (Aggregat über alle nicht archivierten
  // Echtgeld-Depots) oder 'depot:<id>'. Format und Auflösung ausschließlich in
  // `lib/portfolio-scope.ts`. In der DB und nicht im Cookie, damit
  // Server-Komponenten sie ohne Client-Zustand lesen.
  activeScope: text('activeScope').notNull().default('echtgeld'),
  // Etappe 14: Wohin Alarm-Mails gehen. Leer = die Adresse des Kontos gilt
  // (`resolveRecipient` in `lib/notify/alert-mail.ts`). Bewusst kein Backfill — eine
  // kopierte Adresse liefe beim Ändern des Kontos auseinander.
  notifyEmail: text('notifyEmail'),
  notifyByEmail: boolean('notifyByEmail').notNull().default(true),
  // Aussehen der Charts als JSON (Migration 0028). NULL = Auslieferungszustand.
  // Gelesen wird ausschließlich über `normalizeAppearance`
  // (`lib/chart-appearance.ts`) — nie roh an den Chart geben.
  chartAppearance: text('chartAppearance'),
  // Zeichen-Standards als JSON (Migration 0030): mit welchen Fibonacci-Levels,
  // welcher Farbe und welcher Strichstärke eine NEUE Zeichnung beginnt.
  // NULL = Auslieferungszustand. Gelesen ausschließlich über
  // `normalizeDrawingDefaults` (`lib/drawing-defaults.ts`).
  drawingDefaults: text('drawingDefaults'),
  // Werkzeug-Einstellungen als JSON (Migration 0031): Favoritenleiste,
  // „Werkzeug bleibt aktiv", Magnet. NULL = Auslieferungszustand. Gelesen
  // ausschließlich über `normalizeToolPrefs` (`lib/chart-tools.ts`).
  chartTools: text('chartTools'),
})

// Ein- und Auszahlungen auf ein DEPOT. Ohne sie rechnet die Rendite gegen
// ein fixes Startkapital und wird ab der ersten Nachzahlung falsch.
export const cashflow = pgTable('cashflow', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  // Seit Etappe 12 Pflicht: eine Einzahlung gehört in genau ein Depot, sonst
  // verfälschte sie die Rendite aller Depots gleichzeitig.
  portfolioId: integer('portfolioId').notNull(),
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
  // Das Depot, in das dieser Trade gebucht ist (Etappe 12). Pflicht — und die
  // QUELLE der Handelsart: `tradedWithMoney` weiter unten ist nur die
  // abgeleitete Schreibweise von `portfolio.kind`. Jede Auswertung filtert
  // zuerst hierüber; ein Trade ohne Depot fiele stumm aus allen Kennzahlen.
  portfolioId: integer('portfolioId').notNull(),
  // optional link to an instrument in the watchlist (shared hit-rate key)
  stockId: integer('stockId'),
  ticker: text('ticker').notNull(),
  market: text('market').notNull().default('aktien'),
  // Erfassungsweg (Migration 0018): 'langfristig' = voller Weg mit Fragen-Gate,
  // 'schnell' = nur das Nötigste, Gate und Check-in entfallen. An diesem Feld
  // hängen zwei Guard-Entscheidungen — die Regeln stehen in lib/trade-kind.ts.
  tradeKind: text('tradeKind').notNull().default('langfristig'),

  // Etappe 14: Stellt dieser Trade seine Wecker selbst? Beim Anlegen den
  // Einstieg, beim Aktivieren Stop und Ziele. Vorgabe an — ein Wecker zu viel
  // ist eine Meldung, die man wegräumt, einer zu wenig ein verpasster Einstieg.
  alertsEnabled: boolean('alertsEnabled').notNull().default(true),

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
  // Mit echtem Geld gehandelt vs. Demo/Papertrade.
  //
  // ABGELEITET, KEINE EINGABE (seit Etappe 12): Der Wert kommt aus
  // `portfolio.kind` des Depots in `portfolioId` und wird ausschließlich in
  // `createTrade` und `moveTrade` geschrieben — nirgends sonst. Die Spalte
  // bleibt bestehen, damit die reinen Rechenfunktionen in lib/ (trade-stats,
  // trade-events, instrument-stats, excursion) unverändert gültig bleiben: Das
  // Depot-Modell wirkt über die Auswahl der Zeilen, nicht über neue Rechenwege.
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
  // Zeitpunkt der VERSANDTEN Benachrichtigung (Etappe 14, Migration 0024).
  // Bewusst getrennt von `triggeredAt`: ausgelöst ist die fachliche Wahrheit und
  // darf nicht davon abhängen, ob eine Mail durchkam. Ein Lauf schickt nur für
  // `triggeredAt != null AND notifiedAt IS NULL` — dadurch nie zweimal dieselbe
  // Mail, und ein Versandfehler wird beim nächsten Lauf erneut versucht.
  // MIT Zeitzone, weil daraus gerechnet wird (siehe Migration 0021).
  notifiedAt: timestamp('notifiedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Etappe 14: Protokoll der Alarm-Prüfläufe. Der Takt kommt von einem externen
// Cron-Dienst (Vercel-Hobby lässt nur einen Lauf pro Tag zu) — fällt der still
// aus, sähe die App fertig aus und bliebe stumm. Diese Tabelle macht das
// sichtbar: die Einstellungen zeigen „letzter Prüflauf: vor X Minuten".
export const alertCheckRun = pgTable('alert_check_run', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('startedAt', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finishedAt', { withTimezone: true }),
  // cron | client — läuft nur noch 'client', ist der externe Job tot.
  trigger: text('trigger').notNull().default('cron'),
  alertsOpen: integer('alertsOpen').notNull().default(0),
  triggered: integer('triggered').notNull().default(0),
  mailsSent: integer('mailsSent').notNull().default(0),
  mailsFailed: integer('mailsFailed').notNull().default(0),
  error: text('error'),
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

// Teilziele (Etappe 13): die geplanten Ausstiegsstufen eines Trades. Ein Trade
// darf mehrere Take-Profits tragen — „die halbe Position bei 1 R, der Rest
// läuft" ist ab hier ein festgeschriebener Teil des Plans und keine Entscheidung
// mitten im Trade.
//
// `trade.takeProfit` bleibt bestehen und ist ab jetzt die abgeleitete
// Schreibweise der ERSTEN Stufe (wie `tradedWithMoney` die Schreibweise von
// `portfolio.kind` ist) — dadurch bleiben alle reinen Rechenfunktionen und jede
// bestehende Anzeige unverändert gültig. Ein Trade ohne Zeilen hier verhält sich
// exakt wie vorher; sein `takeProfit` wird als eine implizite Stufe gelesen
// (`effectiveTargets` in lib/trade-targets.ts). Kein Backfill.
//
// Die Ausführung einer Stufe IST ein `teilverkauf`/`geschlossen`-Event; diese
// Zeile rechnet nichts nach, sie zeigt über `eventId` darauf.
export const tradeTarget = pgTable('trade_target', {
  id: serial('id').primaryKey(),
  tradeId: integer('tradeId').notNull(),
  // Eigenständig neben tradeId (wie bei trade_event) — die Abfrage kommt ohne
  // Join auf "trade" aus und filtert trotzdem hart auf den Eigentümer.
  userId: text('userId').notNull(),
  // 0-basiert, aufsteigend nach Abstand zum Einstieg (Stufe 1 = am nächsten).
  // Hergestellt beim Speichern, nicht vom Formular erwartet.
  sortOrder: integer('sortOrder').notNull().default(0),
  price: doublePrecision('price').notNull(),
  // Anteil der ANFANGSposition auf dieser Stufe (0..100]. Die Summe darf unter
  // 100 bleiben — der Rest läuft dann bis zur letzten Stufe.
  sharePct: doublePrecision('sharePct').notNull(),
  // Ausführung: alle drei zusammen gesetzt oder alle drei leer.
  executedAt: timestamp('executedAt'),
  executedPrice: doublePrecision('executedPrice'),
  executedQty: doublePrecision('executedQty'),
  // Das Ereignis, mit dem diese Stufe abgerechnet wurde.
  eventId: integer('eventId'),
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

// --- Replay-Trainer (Migration 0026) ---------------------------------------
// Eine Trainingseinheit: historischer Ausschnitt, VOR dem Aufdecken
// festgeschriebene These, danach die Bewertung. Die Reihenfolge ist der Wert
// der Übung — deshalb liegen These (hier), Zeichnungen und Bewertung in drei
// Tabellen und nicht in einer Zeile.
export const trainingSession = pgTable('training_session', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  // Optional — ein frei eingegebenes Symbol hat kein Instrument. Ist es
  // gesetzt, laufen die Kerzen über die Symbolauflösung (Etappe 9/11).
  stockId: integer('stockId'),
  symbol: text('symbol').notNull(),
  market: text('market').notNull(),
  timeframe: text('timeframe').notNull(),
  // frei | zufall | elliott
  mode: text('mode').notNull().default('frei'),
  blind: boolean('blind').notNull().default(false),
  candleCount: integer('candleCount').notNull().default(0),
  startIndex: integer('startIndex').notNull().default(0),
  // Gewünschter Vorlauf in Kerzen (Migration 0030): wie viel Vergangenheit vor
  // der ersten Entscheidung sichtbar ist. NULL = die bisherige Formel.
  // Aus einem Chart ohne Vergangenheit lässt sich nichts ableiten — man rät.
  leadIn: integer('leadIn'),
  firstCandleTime: integer('firstCandleTime'),
  startCandleTime: integer('startCandleTime'),
  lastCandleTime: integer('lastCandleTime'),
  // offen | festgeschrieben | bewertet | abgebrochen
  status: text('status').notNull().default('offen'),
  // long | short | keine
  direction: text('direction'),
  elliottCount: text('elliottCount'),
  invalidation: doublePrecision('invalidation'),
  entryPrice: doublePrecision('entryPrice'),
  stopLoss: doublePrecision('stopLoss'),
  takeProfit: doublePrecision('takeProfit'),
  thesisNote: text('thesisNote'),
  // JSON-Array der Anzeigeformen, wie `trade.setupTags`.
  setupTags: text('setupTags'),
  committedAt: timestamp('committedAt', { withTimezone: true }),
  revealedAt: timestamp('revealedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finishedAt', { withTimezone: true }),
  // --- Ausbaustufe 2 (Migration 0029): die Sitzung ist der Replay-Durchlauf ---
  // Wie der Replay anhält: 'auto' (alle `stopEvery` Kerzen) | 'manuell'.
  // Entscheidung dazu ausschließlich in `lib/training-trade.ts`.
  stopMode: text('stopMode').notNull().default('auto'),
  stopEvery: integer('stopEvery').notNull().default(10),
  // Das Ende bestimmt der Nutzer, nicht die App.
  endedAt: timestamp('endedAt', { withTimezone: true }),
})

// Ein geübter Trade INNERHALB einer Sitzung (Migration 0029).
//
// Getrennt von der Sitzung, weil es zwei Zeitpunkte sind: `committedAt` belegt,
// dass die These vor dem Aufdecken stand. Läge sie in der Sitzungszeile, ließe
// sich das nicht mehr belegen — und eine nachträglich anpassbare These misst
// nichts.
//
// `outcome`/`rMultiple` werden GEMESSEN (`measureOutcome`), `rating`/`errorTags`
// sind die eigene Einordnung. Beides nebeneinander: Ein Trade kann sein Ziel
// erreichen und die Zählung trotzdem falsch gewesen sein.
export const trainingTrade = pgTable('training_trade', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull(),
  userId: text('userId').notNull(),
  /** Laufende Nummer in der Sitzung — die Reihenfolge, in der geübt wurde. */
  seq: integer('seq').notNull().default(1),
  // long | short | keine ('keine' = bewusste Enthaltung, nicht in der Quote)
  direction: text('direction').notNull(),
  entryPrice: doublePrecision('entryPrice'),
  stopLoss: doublePrecision('stopLoss'),
  takeProfit: doublePrecision('takeProfit'),
  elliottCount: text('elliottCount'),
  invalidation: doublePrecision('invalidation'),
  thesisNote: text('thesisNote'),
  setupTags: text('setupTags'),
  /** Letzte sichtbare Kerze beim Festschreiben — Startpunkt der Messung. */
  entryCandleTime: integer('entryCandleTime'),
  committedAt: timestamp('committedAt', { withTimezone: true }).notNull().defaultNow(),
  // ziel | stop | offen — NULL, solange der Trade läuft.
  outcome: text('outcome'),
  outcomeCandleTime: integer('outcomeCandleTime'),
  exitPrice: doublePrecision('exitPrice'),
  rMultiple: doublePrecision('rMultiple'),
  /** Stop und Ziel in derselben Kerze → es gilt der Stop, und das steht da. */
  ambiguous: boolean('ambiguous').notNull().default(false),
  // korrekt | teilweise | falsch
  rating: text('rating'),
  errorTags: text('errorTags'),
  note: text('note'),
  ratedAt: timestamp('ratedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})

// Was an einem Haltepunkt entschieden wurde (Migration 0029).
//
// Der Wert steckt in den Zeilen OHNE `tradeId`: Sie zählen, wie oft hingesehen
// und bewusst nichts gemacht wurde. Überhandeln ist sonst nicht messbar — man
// sähe nur die Trades, die entstanden sind, nie die verkniffenen.
export const trainingCheckpoint = pgTable('training_checkpoint', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull(),
  userId: text('userId').notNull(),
  /** NULL = zu diesem Zeitpunkt war kein Trade offen. */
  tradeId: integer('tradeId'),
  candleTime: integer('candleTime'),
  // kein_setup | haelt | gedreht | raus
  decision: text('decision').notNull(),
  note: text('note'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})

// Die Zeichnungen einer Übung. Bewusst NICHT in `chart_drawing`: Übungslinien
// gehören zu einem historischen Ausschnitt, nicht zum Instrument — sonst
// stünden sie im echten Chart neben echten Plan-Levels.
export const trainingAnnotation = pgTable('training_annotation', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull(),
  userId: text('userId').notNull(),
  // Dieselben Typen wie `chart_drawing`.
  type: text('type').notNull(),
  points: text('points').notNull(),
  style: text('style'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})

// Die Bewertung NACH dem Aufdecken — genau eine je Übung (Unique-Index).
export const trainingResult = pgTable('training_result', {
  id: serial('id').primaryKey(),
  sessionId: integer('sessionId').notNull(),
  userId: text('userId').notNull(),
  // korrekt | teilweise | falsch
  rating: text('rating').notNull(),
  // JSON-Array aus dem FESTEN Katalog in lib/training.ts.
  errorTags: text('errorTags'),
  note: text('note'),
  revealedCandles: integer('revealedCandles'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})

// --- Kerzenspeicher (Migration 0027) ---------------------------------------
// Was einmal beim Anbieter geholt wurde, bleibt hier liegen. Grund: Yahoo gibt
// 15-Minuten-Kerzen nur 60 Tage weit heraus — was älter ist, ist dort für immer
// weg, bei uns aber nicht. Ohne `userId`, weil eine Kerze keine Nutzerdatei ist,
// sondern eine öffentliche Marktbeobachtung; Schlüssel ist das ANBIETER-Symbol
// (`BTC-USD`), nie der Rohticker (dieselbe Entscheidung wie `quote_snapshot`).
export const candleCache = pgTable(
  'candle_cache',
  {
    symbol: text('symbol').notNull(),
    interval: text('interval').notNull(),
    // Unix-Sekunden des Kerzenbeginns (UTC), wie `Candle.time`.
    time: integer('time').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.interval, t.time] })],
)

// Der Zustand je Reihe. Trägt die eine Angabe, die aus den Kerzen selbst nicht
// hervorgeht: wann wir zuletzt beim Anbieter waren. Daran hängen die
// Frischeprüfung beim Lesen und die Rotation im Sammellauf.
export const candleSeries = pgTable(
  'candle_series',
  {
    symbol: text('symbol').notNull(),
    interval: text('interval').notNull(),
    market: text('market'),
    firstTime: integer('firstTime'),
    lastTime: integer('lastTime'),
    candleCount: integer('candleCount').notNull().default(0),
    fetchedAt: timestamp('fetchedAt', { withTimezone: true }),
    lastError: text('lastError'),
    failCount: integer('failCount').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.interval] })],
)

// Protokoll der Sammelläufe — wie `symbol_sync_run` und `alert_check_run`.
// Der Takt kommt von außen (GitHub-Workflow); ohne Protokoll wäre ein
// ausgefallener Lauf von einem ruhigen Markt nicht zu unterscheiden.
export const candleCollectRun = pgTable('candle_collect_run', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('startedAt', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finishedAt', { withTimezone: true }),
  // cron | manual
  trigger: text('trigger').notNull().default('cron'),
  seriesDue: integer('seriesDue').notNull().default(0),
  seriesFetched: integer('seriesFetched').notNull().default(0),
  seriesFailed: integer('seriesFailed').notNull().default(0),
  candlesAdded: integer('candlesAdded').notNull().default(0),
  error: text('error'),
})
