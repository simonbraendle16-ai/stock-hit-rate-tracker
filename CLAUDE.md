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
- Datenzugriff: **Server Actions** (`app/actions/{trades,stocks,settings}.ts`, `'use server'`).
  Einzige API-Route ist Better Auth (`app/api/auth/[...all]`).
- Schema: `lib/db/schema.ts` — Kern-Tabellen `stock` (Watchlist/Instrument),
  `assessment` (reine Prognose, kein Geld), `trade` (echter/geplanter Trade mit
  Douglas- + Elliott-Feldern).

## Domänen-Begriffe (nicht verwechseln)
- **assessment** = reine Prognose ohne Position (füttert Hit-Rate-Kurve).
- **trade** = echter/geplanter Trade, Lifecycle: geplant → aktiv → abgeschlossen/abgebrochen.
- **Disziplin-Score** ≠ Gewinnquote: misst Plan-Treue, nicht Ergebnis.
- **Erwartungswert in R** (R-Multiple), **Plan-Streak**, **Zonen-Trefferquote**,
  **Geld-vs-Paper**-Split.
- Guards: **Pre-Trade-Gate** (alle 9 = "ja" nötig zum Aktivieren) · **Plan-Lock**
  (Stop/Invalidation verschieben = Regelbruch) · **Revenge-Guard** (60-Min-Cooldown nach
  Verlust) · **bewusste Verlustannahme** beim Schließen.

## Konventionen
- **Sprache:** UI und Texte auf Deutsch; Umlaute (ä/ö/ü/ß) immer korrekt.
- **Design:** edel/institutionell "Privatbank-Nacht" (App läuft dark), IBM Plex,
  Geldfarben kräftig & strahlend — **kein Neon/Glow/Sci-Fi**. Farbvariablen in
  `app/globals.css` (BG `#0b1522`, Akzent `#45a8ec`, Grün `#4FBE8C`, Rot `#D8505F`,
  Gold `#D4AC4E`). Karten-Optik: `.glass-card`.
- **Nicht neu erfinden:** Geld-/R:R-/Positionsmathematik lebt in `lib/trade-math.ts`,
  die Pre-Trade-Fragen in `lib/pre-trade-questions.ts` (gemeinsame Quelle für Client +
  Server-Gate). Wiederverwenden statt duplizieren.
- Keine VS-Code-/IDE-Artefakte anlegen (kein `.vscode/`), außer ausdrücklich verlangt.

## Aktuelles Vorhaben
TradingView-Chart einbetten & mit dem Trading-Plan verbinden — Arbeitspakete siehe
`~/.claude/plans/kind-seeking-snowflake.md`.
