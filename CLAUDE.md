# CLAUDE.md — Stock Hit Rate Tracker

> **Detailwissen: `PROJEKT-KONTEXT.md`** (Domänen-Begriffe je Etappe, Begründungen,
> Fallstricke im Volltext). Bei Fragen zu einem Begriff dort **per Grep** nachschlagen,
> statt zu raten. Weiter: `ROADMAP.md` (abgearbeitet) · `IDEEN-BACKLOG.md` (offen).

## Pflege dieser Datei
Diese Datei bleibt unter ~5 KB. Neue Etappen-Details, Begründungen und Fallstricke gehören
nach `PROJEKT-KONTEXT.md` — hier steht nur, was in JEDER Session gebraucht wird.

## Was das ist
Deutschsprachiges **Trading-Disziplin- & Trefferquoten-Journal nach Mark Douglas**.
Fokus = Prozess & Psychologie, nicht Prognose. Trades vom User eingegeben (Postgres).

## Douglas-Perspektive (Leitplanke für JEDE Feature-Entscheidung)
- **Prozess vor Ergebnis, Wahrscheinlichkeit vor Vorhersage.** Ein guter Trade ist ein
  plan-konformer Trade — unabhängig von Gewinn/Verlust. Risiko steht **vor** dem Einstieg fest.
- **BAUE**, was Prozess & vordefiniertes Risiko stärkt. **BAUE NICHT**, was Prognose-/
  Meinungssucht füttert (Rating-Gauges, Social-Feeds, Screener).
- **Kein stiller Falschwert.** Lieber „unbekannt" mit Zeitstempel als eine plausible falsche
  Zahl; Schwellen („x von 20") statt Quoten aus zu wenig Daten.
- Ton: nüchtern, verantwortungsbewusst. Kein Hype, keine Gewinnversprechen.

## Stack & Befehle
Next.js 16 (App Router) · React 19 · TS · Drizzle + Postgres (`pg`) · Better Auth ·
Tailwind v4 + shadcn · recharts · pnpm via corepack.
- Dev `pnpm dev` · Build `pnpm build` · **Prüfen: `pnpm test` + `pnpm exec tsc --noEmit`**
  (`pnpm lint` schlägt fehl, ESLint fehlt). Meist läuft schon ein `next dev` auf :3000.
- Migrationen: **handgeschriebenes SQL** in `drizzle/`, additiv + idempotent, angewendet per
  `node scripts/apply-migration.mjs`. Die DB enthält echte Trades.
- Nach Ordner-Verschiebung: `CI=true corepack pnpm install`.

## Architektur
- Routen: `/` Cockpit · `/trades` · `/analysis` · `/tracking` · `/stock/[id]` · `/trainer` ·
  `/settings`. Datenzugriff über **Server Actions** (`app/actions/*.ts`); API nur Better Auth,
  `/api/{candles,sparklines,quote}` und `/api/cron/*`.
- Schema `lib/db/schema.ts`: `stock` · `assessment` (Prognose ohne Geld) · `trade` ·
  `trade_event` · `trade_target` · `price_alert` · `portfolio` · `quote_snapshot` ·
  `candle_cache` · `training_*`.
- Reine, getestete Logik liegt in `lib/` (`trade-math`, `trade-stats` mit `baseBucket`/
  `bucketRs` als gemeinsamem Kennzahlen-Kern, `trade-events`, `trade-targets`, `excursion`,
  `bot-twin`, `alerts`, `market-data/*` u. a.) — **wiederverwenden, nie neu erfinden**.

## Harte Regeln
- **`'use server'`-Dateien exportieren ausschließlich async Funktionen** — auch `export type`
  bricht den Build. Typen/Konstanten nach `lib/`.
- **Nie den Rohticker an einen Anbieter geben.** Übersetzung nur über `lookupProviderSymbol` /
  `createSymbolResolver`; ein Trade wird über sein **Instrument** (`stockId`) aufgelöst, nie
  über seinen Ticker — **wer Marktdaten holt, reicht `stockId` mit**. Syntaxprüfung nur über
  `lib/market-data/symbol-syntax.ts`.
- **Kerzen nur über `getCachedCandles`, Kurse nur aus `quote_snapshot`** — nie direkt vom Anbieter.
- **Guards:** Pre-Trade-Gate (9 Fragen) · Plan-Lock · Revenge-Guard (60 Min) · bewusste
  Verlustannahme · Emotions-Check-in. Ob ein Guard greift, entscheidet `lib/trade-kind.ts`.
- **Geldkennzahlen filtern immer auf `tradedWithMoney`** (Echtgeld ≠ Demo).
- Kein `.vscode/`, keine IDE-Artefakte.

## Design
- UI deutsch, Umlaute korrekt. „Indigo-Nacht" (dark), IBM Plex, **kein Neon**. Tokens in
  `app/globals.css`; Chart-Farben nur aus `components/chart/colors.ts`.
- Karten nur `.panel` / `.panel-raised` / `.panel-sunken`; Tiefe aus Ebenen, nicht aus Leuchten.
  **Glow nur** am Disziplin-Ring und an Statuspunkten, nie auf Geldbeträgen. Keine deckende
  Fläche über das Layout. Dauerbewegung nur mit echtem Zustand dahinter, **nie an Kursdaten**;
  alles in `@media (prefers-reduced-motion: no-preference)`.
- Bausteine wiederverwenden: `chart-frame` · `form-frame` · `section-label` · `instrument-card`.
- **`position: fixed` im Chart braucht Portal ans `<body>` UND `position:'fixed'` inline**
  (`.rise-in` setzt ein `transform`; `body > * {position:relative}` schlägt die Utility).

## Code-Exploration: codegraph zuerst
Für **strukturelle** Fragen (Aufrufer, Datenfluss, Auswirkungsradius, Architektur, Bug-Suche)
immer zuerst `mcp__codegraph__codegraph_explore` — ersetzt hier die globale Grep-zuerst-Regel;
gelieferter Quelltext gilt als gelesen.

## Fallstricke (Volltext in `PROJEKT-KONTEXT.md`)
- **Vercel-Hobby lässt Cron nur 1×/Tag** — ein engerer Takt lässt das **ganze Deployment**
  scheitern; der 5-Minuten-Takt liegt in GitHub Actions. **`CRON_SECRET`** muss lokal **und**
  in Vercel gesetzt sein. Nach einem Push prüfen, ob Vercel wirklich gebaut hat.
- **Yahoo stuft bei `range=max` still herab.** Status 200, kein Fehlerfeld — nur
  `meta.dataGranularity` verrät es. `1wk` **und** `1mo` kamen als derselbe Satz zurück
  (je nach Historie Quartals-, Monats- oder Wochenkerzen), abgelegt unter „W" und „M".
  Deshalb steht dort jetzt `30y`, und **jede** Antwort läuft durch `passtGranularitaet`
  (`lib/market-data/yahoo.ts`): Weicht die Granularität ab, wird verworfen statt gespeichert.
- **Der Kerzenspeicher konserviert Irrtümer** → `node scripts/clean-candle-cache.mjs [--dry]`
  (Rohticker-Reihen) und `node scripts/clean-candle-granularity.mjs [--dry]` (W/M mit
  falschem Median-Abstand). **Aufräumen erst NACH dem Deployment:** Der 5-Minuten-Sammellauf
  trifft dieselbe DB über Vercel — mit altem Code holt er die falschen Reihen sofort zurück
  (gemessen: 117 von 119 nach neun Minuten wieder da).
- **Zeichen-Vorschauen sind per Screenshot nicht prüfbar** (leben nur zwischen `pointerdown`
  und `pointerup`); `rect` vor jeder Ereignisfolge neu messen. `requestAnimationFrame` feuert
  im verborgenen Tab nie. Ein HMR-`ReferenceError` sieht aus wie ein eingefrorener Tab.
- **Mobil:** `overflow-x-auto` braucht zusätzlich `min-w-0`; `shrink-0` an langem Text sprengt
  die Seite. Viewport-Prüfung per iframe fester Breite, nicht über `resize_window`.
