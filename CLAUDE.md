# CLAUDE.md — Stock Hit Rate Tracker

## Was das ist
Ein deutschsprachiges **Trading-Disziplin- & Trefferquoten-Journal nach Mark Douglas**
("Trading in the Zone"). Fokus = Prozess & Psychologie, nicht Prognose. Kurse/Trades sind
vom User eingegeben (Postgres). **Aktuell im Ausbau:** ein eingebetteter TradingView-Chart,
der eng mit dem Trading-Plan verbunden wird (Roadmap: `~/.claude/plans/kind-seeking-snowflake.md`).

## Douglas-Perspektive (Leitplanke für JEDE Feature-Entscheidung)
Denke und baue aus Sicht eines disziplinierten Douglas-Traders:
- **Prozess vor Ergebnis, Wahrscheinlichkeit vor Vorhersage.** Ein guter Trade ist ein
  plan-konformer Trade — unabhängig von Gewinn/Verlust.
- **Risiko ist vor dem Einstieg definiert.** Entry, Stop, Target, Invalidation stehen fest,
  bevor Geld im Markt ist.
- **Die 5 Grundüberzeugungen** (siehe `components/discipline-overview.tsx` → `FiveBeliefs`)
  und die 9 Pre-Trade-Fragen (`lib/pre-trade-questions.ts`) sind das Herz der App.
- **Feature-Filter:** BAUE, was Prozess & vordefiniertes Risiko stärkt — z. B. den
  eingebetteten Chart am Plan, Plan-Level (Entry/Stop/Target/Invalidation) im Chart,
  Kurs-Alerts zum "setzen-und-weggehen", Erwartungswert & Disziplin-Metriken.
  BAUE NICHT, was Prognose-/Meinungssucht füttert — Buy/Sell-Rating-Gauges,
  Social-Ideas-Feeds, Hotlists/Screener-Getriebe — auch wenn TradingView es anbietet.
- Tenor der UI-Texte: nüchtern, verantwortungsbewusst ("Handle deinen Plan, nicht deine
  Emotion."). Kein Hype, keine Gewinnversprechen.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM + Postgres (`pg`) ·
Better Auth (Email/PW) · Tailwind v4 + shadcn · recharts (nur Journal-Statistik, keine
Candlesticks) · pnpm via corepack.

## Befehle
- Dev: `pnpm dev`  ·  Build: `pnpm build`  ·  Lint: `pnpm lint`
- DB: `pnpm db:generate` → `pnpm db:push` (Migrationen in `drizzle/`)
- pnpm immer via `corepack pnpm`; bei Symlink-Bruch nach Ordner-Move:
  `CI=true corepack pnpm install`

## Architektur-Landkarte
- Routen (`app/`): `/` Cockpit · `/trades` (+`/new`,`/[id]`) Trade-Lifecycle ·
  `/analysis` reine Prognosen/Hit-Rate · `/tracking` Auswertung (Equity, Drawdown,
  Geld-vs-Paper, CSV) · `/stock/[id]` Instrument-Detail · `/settings` · Auth.
- Datenzugriff: **Server Actions** (`app/actions/{trades,stocks,settings,alerts}.ts`,
  `'use server'`). API-Routen: Better Auth (`app/api/auth/[...all]`), Kerzen
  (`/api/candles`, `/api/sparklines`) und Kurs-Snapshot (`/api/quote`, letzte Kerze).
- Schema: `lib/db/schema.ts` — Kern-Tabellen `stock` (Watchlist/Instrument),
  `assessment` (reine Prognose, kein Geld), `trade` (echter/geplanter Trade mit
  Douglas- + Elliott-Feldern), `price_alert` (Kurs-Alert je Level, Etappe 3).

## Domänen-Begriffe (nicht verwechseln)
- **assessment** = reine Prognose ohne Position (füttert Hit-Rate-Kurve).
- **trade** = echter/geplanter Trade, Lifecycle: geplant → aktiv → abgeschlossen/abgebrochen.
- **Disziplin-Score** ≠ Gewinnquote: misst Plan-Treue, nicht Ergebnis.
- **Erwartungswert in R** (R-Multiple), **Plan-Streak**, **Zonen-Trefferquote**,
  **Geld-vs-Paper**-Split.
- **Live-Stand / Kurs-Alert** (Etappe 3) = Kurs offener Positionen aus der letzten Kerze
  (sichtbar „Kurs von 14:32", NICHT live), plus unrealisierter P&L in Geld **und** R und Balken
  Stop↔Ziel. **Alert** = ein Preislevel (`price_alert`) mit Kreuzungsrichtung `above`/`below`,
  geprüft per `checkAlerts()` beim 5-Min-`AlertWatcher`; Auslösung als Browser-Notification +
  Cockpit-Eintrag (kein Push-Dienst). Logik in `lib/alerts.ts` (rein, getestet).
- **Teilverkauf / Nachkauf / Event-Log** (Etappe 6) = jede Veränderung eines Trades ist ein
  `trade_event` (eroeffnet | teilverkauf | nachkauf | stop_verschoben | ziel_geaendert |
  invalidation_ignoriert | notiz | geschlossen). Ein Trade mit Teilverkauf bleibt **`aktiv`** bis
  die letzte Einheit über `closeTrade` geht. Nach einem Teilverkauf ist risiko-**reduzierendes**
  Stop-Nachziehen erlaubt (kein Regelbruch), Aufweiten bleibt `stop_moved`. Reine Logik in
  `lib/trade-events.ts` (`settlePosition`, `deriveTimeline`, `isRiskReducingStop`); die
  Geldkennzahlen in `lib/trade-stats.ts` sind **event-aware** (Trade mit Events → aus dem
  Settlement, sonst wie bisher). Chronik auf `/trades/[id]`; Alt-Trades werden ohne Zeitstempel
  abgeleitet (kein Backfill).
- **Wahrscheinlichkeits-Simulation** (Etappe 7a) = Monte-Carlo über die **eigene** R-Verteilung:
  aus den abgerechneten Trades werden mit Zurücklegen 10.000 Verläufe à 50 Trades gezogen
  (Bootstrap, fester Seed → reproduzierbar). Antwortet auf „gehört diese Verlustserie zu meinen
  Zahlen?", **nicht** auf „wie läuft der nächste Trade". Logik in `lib/monte-carlo.ts` (rein,
  getestet, gegen eine geschlossene Markov-Lösung geprüft); Eingang sind `ratedRMultiples`
  (dieselbe Auswahl wie der Erwartungswert) und `medianRiskFraction` (Median über Echtgeld-Trades
  mit echter Stopdistanz — nur damit wird ein Rückgang in R zu Kontoprozent). Unter
  `MIN_TRADES` = 20 abgerechneten Trades erscheint **keine** Wahrscheinlichkeit, sondern
  „x von 20". Panel: `components/monte-carlo-panel.tsx` auf `/tracking`.
- **Setup-Tags / Setup-Vergleich** (Etappe 7b) = kurze, **frei benannte** Schubladen am Trade
  (`setupTags`, JSON-Array, Migration `0016`) neben dem `strategy`-Freitext, der die
  **Begründung** bleibt. Kein fester Katalog (Setups sind persönlich, anders als die
  Emotions-Tags); vergleichbar werden sie über den normalisierten Schlüssel in `lib/setups.ts`
  (klein, Umlaute deutsch gefaltet ä→ae, nur Buchstaben/Ziffern) — „Breakout"/„break-out" sind
  ein Setup. Höchstens `MAX_SETUP_TAGS` = 3 je Trade, ein Trade zählt in jede seiner Zeilen
  (Mehrfachzählung). Auswertung `computeSetupStats` (event-aware, nur **entschiedene** Trades):
  Anzahl, Trefferquote, Erwartungswert, Ø Haltedauer, bestes/schlechtestes R; unter
  `MIN_SETUP_TRADES` = 10 keine Quote. **Kein Backfill** — Altbestand ist „ohne Angabe";
  `suggestSetupTags` schlägt aus einem *aufzählungsartigen* Freitext Tags vor (aus einem Satz
  bewusst keine). Tags dürfen auch bei **abgeschlossenen** Trades noch gesetzt werden
  (`updateTradeSetupTags`, nicht `updateTradePlan`) — ein Tag ist Einordnung, kein Plan.
  Panel: `components/setup-comparison-panel.tsx` auf `/tracking`, Eingabe
  `components/setup-tags-input.tsx`.
- **Zeit-Heatmap / Haltedauer** (Etappe 7d) = wann handle ich gut, wann schlecht. Gitter
  **Wochentag × Tagesblock** nach der **Einstiegszeit** (`openedAt` — dort fällt die
  Entscheidung), eingefärbt nach Erwartungswert. Vier Blöcke statt 24 Stunden (Vormittag 6–12 ·
  Mittag 12–14 · Nachmittag 14–18 · Abend/Nacht 18–6, lokale Zeit, Abend läuft über
  Mitternacht); Mo–Fr plus eine Zeile **Sa/So**, die nur erscheint, wenn sie Trades trägt
  (Krypto läuft durch). Schwelle `MIN_TIME_CELL_TRADES` = **3** je Zelle — darunter nur die
  Anzahl, keine Quote, keine Farbe. Zeitzone ist die **lokale Zeit der App**, nicht die
  Handelszeit der Börse (steht so in der Fußnote des Panels). Trades ohne `openedAt` fallen aus
  dem Gitter, aber nicht aus dem Blick (Abdeckungszeile) — **kein Backfill**. Dazu Haltedauer
  gegen Ergebnis in vier Klassen (< 1 T · 1–3 T · 3–14 T · > 14 T). Logik `computeTimeStats` in
  `lib/trade-stats.ts` (rein, getestet, event-aware), Panel
  `components/time-heatmap-panel.tsx`. **Ohne Migration.** Der gemeinsame Kennzahlen-Kern von
  Zustand, Setup und Zeit liegt in `baseBucket`/`bucketRs` — neue Auswertungszeilen dort
  aufsetzen, nicht neu rechnen.
- **Bot-Zwilling** (Etappe 5) = derselbe Plan mechanisch nachgerechnet: Kerze für Kerze ab
  `openedAt`, **über den echten Ausstieg hinaus**, bis Stop oder Ziel berührt ist (beides in
  derselben Kerze → konservativ der Stop). Antwortet auf „was kostet mich mein eigenes
  Eingreifen?". Die **Differenz ist `Du − Bot`**: negativ = das Eingreifen hat gekostet, positiv =
  der Plan gehört überarbeitet. Aufschlüsselung in fünf Eimer (zu früh · zu spät · Stop verschoben
  · besser als der Plan · wie geplant), jeder Trade in genau einem. Logik in `lib/bot-twin.ts`
  (rein, getestet), Laden/Auflösung in `app/actions/bot-twin.ts`, Anzeige in
  `components/bot-twin-panel.tsx` + `-curve` + `bot-outcome-dialog`. **Schreibt nichts** —
  gerechnet wird live über `getCachedCandles`. Auflösung adaptiv nach Haltedauer (≤3 T
  Stundenkerzen, ≤1 Mon 4h, sonst Tageskerzen) mit Rückfall auf gröber, wenn die Historie nicht
  zurückreicht. Das Minutenlimit gilt **je Anbieter** (Binance ≠ Twelve Data). Nicht simulierbare
  Trades werden mit Grund ausgewiesen und dürfen von Hand nachgetragen werden
  (`bot_manual_outcome`, Migration 0015) — Messung schlägt dabei immer Eingabe. Geplante, nie
  eingegangene Trades (`kein_handel`) laufen in einem **getrennten** Block, nie in der
  Hauptdifferenz.
- **MAE / MFE** (Etappe 7c) = wie weit lief der Kurs **während der Haltedauer** gegen dich
  (Maximum Adverse Excursion) und wie weit für dich (Favourable), je in R. Abgrenzung zum
  Bot-Zwilling: der rechnet **über** den echten Ausstieg hinaus, MAE/MFE misst **nur** die Zeit
  im Markt — deshalb auch für Trades ohne Ziel messbar. **Fenster:** ab der ersten Kerze *nach*
  dem Einstieg (die angebrochene Einstiegskerze bleibt draußen) bis *einschließlich* der
  Ausstiegskerze; bei Teilverkäufen bis zum letzten Abschluss. Gemessen wird aus Hoch/Tief, nie
  aus Schlusskursen. **Kerzen kommen aus demselben Durchlauf wie der Bot-Zwilling** —
  `createCandleLoader` + `resolveExcursion` in `lib/market-data/candle-loader.ts`, damit kein
  Symbol zweimal angefragt wird; neue kerzenbasierte Auswertungen dort andocken, **nie** einen
  zweiten Ladeweg aufmachen. Reine Logik in `lib/excursion.ts` (getestet):
  `computeExcursion` · `manualExcursionRun` · `resolveRun` · `aggregateExcursion`; Auswertung
  getrennt nach Gewinnern/Verlierern, `MIN_EXCURSION_TRADES` = 5. **Grob gemessen** = die Kerze
  ist länger als die Haltedauer; solche Messungen zählen mit, werden gekennzeichnet und sind der
  **einzige** Fall, in dem ein Nachtrag eine Messung überstimmt (sonst gilt weiter „Messung
  schlägt Eingabe"). Nachgetragen werden **Kurse**, nie R-Werte (`trade_excursion`, Migration
  `0017`, nur Nachträge). Ton: der Block **beobachtet** („deine Gewinner liefen im Schnitt 0,5 R
  weiter, als du sie gehalten hast"), er ordnet nichts an. Panel
  `components/excursion-panel.tsx` auf `/tracking`, Karte `components/excursion-card.tsx` auf
  `/trades/[id]`.
- **Emotions-Check-in** = zwei Momentaufnahmen je Trade (Aktivieren + Abschließen):
  Skala 1–5 (ruhig ↔ aufgewühlt) + Tags aus fester Liste. **Skala ist Pflicht**, Tags/Notiz
  freiwillig. Auswertung „Zustand & Ergebnis" auf `/tracking`; unter 10 Trades je Gruppe
  zeigt sie bewusst keine Quote.
- Guards: **Pre-Trade-Gate** (alle 9 = "ja" nötig zum Aktivieren) · **Plan-Lock**
  (Stop/Invalidation verschieben = Regelbruch; **Ausnahme ab Etappe 6:** nach einem Teilverkauf
  ist risiko-reduzierendes Stop-Nachziehen erlaubt, Invalidation bleibt streng) · **Revenge-Guard**
  (60-Min-Cooldown nach Verlust) · **bewusste Verlustannahme** beim Schließen · **Emotions-Check-in**
  (`activateTrade`/`closeTrade` lehnen ohne gültige Skala ab).

## Konventionen
- **Sprache:** UI und Texte auf Deutsch; Umlaute (ä/ö/ü/ß) immer korrekt.
- **Design:** edel/institutionell "Indigo-Nacht" (App läuft dark), IBM Plex,
  Geldfarben kräftig & strahlend — **kein Neon, kein Sci-Fi**. Farbvariablen in
  `app/globals.css` (Seite `#0f1124`, Panel `#191c3a`, Hell `#ecebfa`, Akzent
  `#7b6bf6`, Grün `#4fd6a0`, Rot `#f2607a`, Gold `#e0b455`). Karten-Optik:
  `.panel` / `.panel-raised` / `.panel-sunken` — app-weit die einzigen drei
  Kartenebenen (der alte Alias `.glass-card` ist mit Design E entfallen).
- **Tiefe kommt aus Ebenen, nicht aus Leuchten.** Die Stufen Seite → Panel →
  `.panel-raised` sind bewusst weit auseinandergezogen; eng beieinander liegende
  Töne lassen die Oberfläche flach wirken. Der Seitenhintergrund
  (`components/app-backdrop.tsx`) trägt leuchtende Kerzen in den Randzonen neben
  der Inhaltsspalte — **nie darunter**, damit Daten lesbar bleiben.
- **Keine deckende Fläche über das Layout legen.** Ein `bg-background` auf dem
  Seiten-Wrapper verdeckt den App-Hintergrund vollständig. Die Routen-Wurzel ist
  deshalb `<div className="min-h-svh">` ohne Hintergrundfarbe.
- **Glow ist die Ausnahme, nicht die Regel.** Erlaubt ausschließlich am
  Disziplin-Ring (`.svg-glow`) und an Statuspunkten (`.dot-glow`). Nirgends sonst —
  insbesondere nicht auf Geldbeträgen: das rückt Ergebnis vor Prozess.
- **Bewegung:** Aufbau beim Mount und bei Zustandswechseln (`.rise-in`, `.bar-fill`,
  `.ring-value`, `CHART_MOTION`). **Dauerbewegung nur, wo echter Zustand
  dahintersteht** — ein offener Alert pulst (`.dot-pulse`), weil er tatsächlich auf
  eine Kursmarke wartet; ein ausgelöster steht still. **Niemals an Kursdaten**: die
  sind bis zu 5 Minuten alt, ein "LIVE"-Signal wäre eine Falschaussage. Ausgenommen
  ist die kontrastarme Hero-Atmosphäre (`.hero-atmo`) und die Leerzustands-Schleife
  (`.empty-path`). Alles gehört in `@media (prefers-reduced-motion: no-preference)`,
  und der Endzustand muss ohne Bewegung korrekt aussehen.
- **Nicht neu erfinden:** Geld-/R:R-/Positionsmathematik lebt in `lib/trade-math.ts`,
  die Pre-Trade-Fragen in `lib/pre-trade-questions.ts`, Skala und Emotions-Tags in
  `lib/emotions.ts` (je gemeinsame Quelle für Client + Server-Gate + Auswertung).
  Wiederverwenden statt duplizieren. Für die Oberfläche gilt dasselbe: Diagrammköpfe und
  Leerzustände in `components/chart-frame.tsx` (`ChartHeader`/`ChartEmpty`), Formularteile in
  `components/form-frame.tsx` (`FormSection` · `Field` · `ChoiceButton` · `ResultBlock` ·
  `ResultRow` · `InlineNotice`), Sektionsbeschriftung in `components/section-label.tsx`.
- **Chart-Farben kommen aus `components/chart/colors.ts`** (`CHART_COLORS`, `PLAN_COLORS`) —
  Canvas und SVG können `var(--positive)` nicht lesen, deshalb steht die Hex-Entsprechung der
  Tokens dort **einmal** und wird nirgends sonst wiederholt. Ausnahme mit Absicht: das
  TradingView-Schema in `price-chart.tsx` trägt die Originalfarben von TradingView und darf
  sich nicht mitbewegen.
- Keine VS-Code-/IDE-Artefakte anlegen (kein `.vscode/`), außer ausdrücklich verlangt.

## Roadmap & Ideen
- **`ROADMAP.md`** — die geplanten Etappen 2–7, je mit Datenmodell, Dateien, konkretem Ergebnis
  und den vor dem Bauen zu klärenden Fragen. **Erster Blick bei „was machen wir als Nächstes".**
- **`IDEEN-BACKLOG.md`** — der vollständige Ideenvorrat darüber hinaus.
- Erledigt: Chart-Cockpit (AP 0–10) · Etappe 1 „Geld-Fundament" (Migration `0010`) ·
  Etappe 4 „Emotions-Check-in" (Migration `0011`) · Etappe 3 „Live-Kurse und Alerts"
  (Migration `0012`, Tabelle `price_alert`) · Etappe 2 „Freunde" (Migration `0013`, Tabellen
  `friendship` + `invite_code`; eine feste Sichtbarkeitsstufe, geplante + abgeschlossene Trades
  in R, nie Beträge) · Etappe 6 „Teilverkäufe und Event-Log" (Migration `0014`, Tabelle
  `trade_event`; echte Teilverkäufe/Nachkäufe, Timeline je Trade, event-aware Geldkennzahlen) ·
  Etappe 7a „Monte-Carlo-Simulator" (**ohne Migration**, rechnet nur über vorhandene Trades;
  `lib/monte-carlo.ts` + Panel auf `/tracking`) · Etappe 5 „Bot-Zwilling" (Migration `0015`,
  Tabelle `bot_manual_outcome` **nur** für Nachträge; die Simulation selbst schreibt nichts —
  `lib/bot-twin.ts` + Panel auf `/tracking`) · Etappe 7b „Setup-Vergleich" (Migration `0016`,
  Spalte `setupTags` am `trade`, **ohne Backfill**; `lib/setups.ts` + `computeSetupStats` +
  Panel auf `/tracking`) · Etappe 7d „Zeit-Heatmap und Haltedauer" (**ohne Migration**,
  `computeTimeStats` + Panel auf `/tracking`) · Etappe 7c „MAE/MFE" (Migration `0017`, Tabelle
  `trade_excursion` **nur** für Nachträge; die Messung selbst schreibt nichts — `lib/excursion.ts`
  + gemeinsamer Kerzen-Ladeweg mit dem Bot-Zwilling, Panel auf `/tracking` + Karte je Trade) ·
  Design A–D (visuelle Überarbeitung) · Design E „Formulare + Chart-Cockpit" (**ohne Migration**,
  rein visuell: `components/form-frame.tsx` + `components/chart/colors.ts` als neue gemeinsame
  Quellen, Chart-Cockpit von der alten Navy-Palette auf Indigo-Nacht).
  **Die Roadmap ist damit vollständig** — offen ist nur noch der Ideenvorrat in
  `IDEEN-BACKLOG.md`.

## Code-Exploration: codegraph zuerst (überschreibt die globale Read-Effizienz-Regel)
Dieses Projekt hat einen lokalen `codegraph`-Index (`.codegraph/`, via MCP-Server `codegraph`).
Die globale "Read-Effizienz — PFLICHT"-Regel (Grep → Read mit offset/limit) gilt **in diesem
Projekt NICHT als erster Schritt** für strukturelle Fragen — codegraph ersetzt sie hier.

Für strukturelle Fragen — Aufrufer/Aufrufe einer Funktion, Datenfluss, Auswirkungsradius
einer Änderung, "wie hängt X mit Y zusammen", Architektur-Überblick, Bug-Suche — **immer
zuerst `mcp__codegraph__codegraph_explore` aufrufen, bevor Grep oder Read benutzt wird.**
Der von codegraph gelieferte Quelltext gilt als bereits gelesen (nicht per Read nachladen).

Grep/Read direkt (ohne vorherigen codegraph-Call) nur für:
- reine Text-/String-Suche ohne Struktur-Bezug (z. B. "wo steht dieser Fehlertext")
- wenn codegraph ein Staleness-Banner zeigt (dann zuerst syncen lassen)
- Dateien außerhalb des indexierten Projekts

Ergebnissen von codegraph vertrauen, keine Grep-Verifikation hinterherschieben.

## Fallstricke, die schon Zeit gekostet haben
- **`'use server'`-Dateien dürfen ausschließlich async Funktionen exportieren.** Turbopack
  behandelt *jeden* Export als Server Action — auch reine `export type { … }`-Re-Exports und
  Konstanten. Der Build bricht mit „A 'use server' file can only export async functions".
  Deshalb liegen Typen in `lib/trade-stats.ts` und Konstanten wie `SUPPORTED_CURRENCIES` in
  `lib/format.ts`, nicht in `app/actions/*.ts`.
- **Migrationen sind handgeschriebenes SQL** in `drizzle/`, angewendet per
  `node scripts/apply-migration.mjs` (liest `DATABASE_URL` aus der Umgebung oder `.env.local`).
  Immer additiv und idempotent — die DB enthält echte Trades. `scripts/baseline-report.mjs`
  zieht vorher/nachher einen Dump zum Vergleich (nur lesend).
- **pnpm nach Ordner-Verschiebung:** `ERR_PNPM_UNEXPECTED_VIRTUAL_STORE` → `CI=true corepack
  pnpm install`.
- **Meist läuft schon ein `next dev` auf :3000** — erst `http://localhost:3000` probieren, dann
  starten. Ein zweiter Start bricht mit „Another next dev server is already running" ab.
- **ESLint ist nicht installiert**, `pnpm lint` schlägt daher fehl. `pnpm test` (Vitest) und
  `pnpm exec tsc --noEmit` sind die tatsächlichen Prüfungen.
