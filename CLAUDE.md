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
- **Design:** edel/institutionell "Privatbank-Nacht" (App läuft dark), IBM Plex,
  Geldfarben kräftig & strahlend — **kein Neon/Glow/Sci-Fi**. Farbvariablen in
  `app/globals.css` (BG `#0b1522`, Akzent `#45a8ec`, Grün `#4FBE8C`, Rot `#D8505F`,
  Gold `#D4AC4E`). Karten-Optik: `.glass-card`.
- **Nicht neu erfinden:** Geld-/R:R-/Positionsmathematik lebt in `lib/trade-math.ts`,
  die Pre-Trade-Fragen in `lib/pre-trade-questions.ts`, Skala und Emotions-Tags in
  `lib/emotions.ts` (je gemeinsame Quelle für Client + Server-Gate + Auswertung).
  Wiederverwenden statt duplizieren.
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
  `trade_event`; echte Teilverkäufe/Nachkäufe, Timeline je Trade, event-aware Geldkennzahlen).

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
