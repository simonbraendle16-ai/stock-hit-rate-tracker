---
name: projekt-landkarte
description: >-
  Orientierung und Arbeitsweise-Leitplanken für das Projekt „Stock Hit Rate Tracker"
  (deutschsprachiges Trading-Disziplin-Journal nach Mark Douglas, Next.js 16 / Drizzle /
  Postgres). Nutze diesen Skill, wann immer du in diesem Projekt arbeitest — eine
  Feature-Entscheidung triffst, ein Feature oder eine Roadmap-Etappe baust, eine Migration
  schreibst, Tests/Build laufen lässt, oder dich fragst „wie ist das hier aufgebaut / wo liegt
  X / darf ich das überhaupt bauen". Enthält den Douglas-Feature-Filter (BAUE / BAUE NICHT), wo
  die reine, testbare Logik liegt, die harte `'use server'`-Regel, den additiven
  Migrations-Workflow samt Nachweis, die Check-Befehle (weil `corepack pnpm` hier bricht) und
  die Design-Tokens. Konsultiere ihn lieber einmal zu oft als eine dieser Leitplanken zu
  verletzen.
---

# Projekt-Landkarte — Stock Hit Rate Tracker

Diese Datei liegt **im App-Repo** (`stock-hit-rate-tracker-extracted/`). Alle Pfade unten sind
relativ zu diesem Repo-Wurzelverzeichnis. (Das Arbeitsverzeichnis der Session kann eine Ebene
höher liegen — dann steckt alles im Unterordner `stock-hit-rate-tracker-extracted/`.)

Sie ergänzt `CLAUDE.md` (immer geladen, knapp) und den `codegraph`-Index (strukturelle
„wer-ruft-was"-Fragen). Hier steht das **stabile, nicht-offensichtliche** Wissen, das man beim
Bauen braucht — keine Datei-für-Datei-Liste (die veraltet und dafür ist codegraph da).

## 1. Worum es geht — und der Feature-Filter (Leitplanke)

Die App ist ein **Douglas-Trading-Journal**: Fokus auf **Prozess & Psychologie**, nicht
Prognose. Ein guter Trade ist ein *plan-konformer* Trade — unabhängig von Gewinn/Verlust.
Risiko (Entry, Stop, Target, Invalidation) steht **fest, bevor Geld im Markt ist**.

Vor **jeder** Feature-Entscheidung durch diesen Filter gehen:

- **BAUE**, was Prozess & vordefiniertes Risiko stärkt: Plan-Level im Chart, Kurs-Alerts zum
  „setzen und weggehen", Erwartungswert-/Disziplin-Metriken, Zustands-/Emotions-Auswertung.
- **BAUE NICHT**, was Prognose-/Meinungssucht füttert: Buy/Sell-Rating-Gauges,
  Social-/Ideas-Feeds, Hotlists/Screener-Getriebe — auch wenn eine Datenquelle es anbietet.
- **Grauzonen so bauen, dass beide Seiten gewinnen.** Beispiel Etappe 2 (Freunde): Trades
  werden erst *nach Abschluss* sichtbar → Lernen ja, Copy-Trading nein.

UI-Ton: nüchtern, verantwortungsbewusst („Handle deinen Plan, nicht deine Emotion."). Kein
Hype, keine Gewinnversprechen.

Die **Guards** sind das Herz der App und dürfen nicht ausgehöhlt werden:
Pre-Trade-Gate (alle Fragen aus `PRE_TRADE_QUESTIONS` = „ja" zum Aktivieren) · Plan-Lock
(Stop/Invalidation eines aktiven Trades verschieben = protokollierter Regelbruch) ·
Revenge-Guard (60-Min-Cooldown nach Verlust) · bewusste Verlustannahme beim Schließen ·
Emotions-Check-in (Skala 1–5 Pflicht beim Aktivieren *und* Abschließen).

## 2. Wo die Logik lebt — reine Funktionen wiederverwenden

**Kernprinzip:** Geld-/Statistik-/Domänenlogik lebt in `lib/` als **reine, testbare Funktionen**
(kein DB-Zugriff, kein Auth, kein React, kein `'use server'`). Die Server Actions laden nur die
Zeilen und **rufen in diese Funktionen hinein** — es gibt bewusst *keine* zweite Rechenlogik
daneben. Wer eine Berechnung braucht, die es schon gibt: wiederverwenden, nicht duplizieren.

| Datei | Enthält |
|---|---|
| `lib/trade-math.ts` | Positions-/Geld-/Gebührenmathematik: `computeShares`, `computeRiskReward`, `projectStopLoss`, `projectTakeProfit` |
| `lib/trade-stats.ts` | P&L & Kennzahlen: `tradeGrossPnl`/`tradePnl`, `tradeRisk`, `computeDisciplineStats`, `computeEquityStats`, `computeMoodStats`, `unrealizedPnl`/`unrealizedR`, `pricePositionFraction` — **plus die gemeinsamen Typen** (`TradeRow`, `DisciplineStats`, …) |
| `lib/emotions.ts` | Skala + feste Tag-Liste (Etappe 4), `normalizeMoodCheck`, Gruppierung |
| `lib/alerts.ts` | Kurs-Alert-Logik (Etappe 3): Richtungswahl, Auslöse-Abgleich, Katalog-Guards |
| `lib/format.ts` | `formatMoney`, `SUPPORTED_CURRENCIES`, Währungsformatierung (reine Anzeige — Kurse werden nie umgerechnet) |
| `lib/pre-trade-questions.ts` | die Douglas-Pre-Trade-Fragen (gemeinsame Quelle für Dialog + Gate) |
| `lib/market-data/` | Kursanbindung: `twelvedata.ts`/`binance.ts` (Provider), `cached.ts` (15 Min intraday / 12 h daily), `quote.ts` (letzte Kerze → Kurs) |

Jede dieser Dateien hat i. d. R. eine `*.test.ts` daneben — neue Rechenlogik dort mit abdecken.

## 3. Datenzugriff & die harte `'use server'`-Regel

- **Schreiben/Lesen läuft über Server Actions** in `app/actions/*.ts` (`trades`, `stocks`,
  `settings`, `cashflows`, `drawings`, `alerts`, `friends`). Alle filtern hart auf `getUserId()` —
  diese Filterung nie aufbohren. Für Fremddaten gibt es genau **eine** Ausnahme-Ebene:
  `app/actions/friends.ts` liest fremde Journale ausschließlich über `assertCanView` (wirft ohne
  angenommene Freundschaft) und gibt nur betragsfreie Sichten zurück (`lib/friends.ts`:
  `projectFriendTrades`/`toFriendSummary` — R-Vielfache + Disziplin, nie ein Betrag).
- **API-Routen** gibt es nur wenige: Better Auth (`app/api/auth/[...all]`), Kerzen
  (`/api/candles`, `/api/sparklines`) und Kurs-Snapshot (`/api/quote`).

> **Falle, die schon Build-Abbrüche gekostet hat:** Eine `'use server'`-Datei darf
> **ausschließlich `async` Funktionen exportieren**. Turbopack behandelt *jeden* Export als
> Server Action — auch `export type { … }` und Konstanten. Deshalb liegen **Typen** in
> `lib/trade-stats.ts` (bzw. der jeweiligen reinen Datei) und **Konstanten** in `lib/format.ts`
> u. a., niemals in `app/actions/*.ts`. Wenn du einen Typ/eine Konstante an der Grenze
> Server↔Client brauchst: in eine reine `lib/`-Datei legen und von beiden Seiten importieren.

Schema: `lib/db/schema.ts`. Better-Auth-Tabellen (`user`/`session`/`account`/`verification`)
haben **camelCase-Spalten — nicht umbenennen**. App-Tabellen: `userSettings`, `cashflow`,
`stock` (Watchlist/Instrument), `assessment` (reine Prognose, kein Geld), `trade` (Lifecycle
geplant→aktiv→abgeschlossen/abgebrochen/kein_handel), `chartDrawing`, `priceAlert`,
`friendship` + `inviteCode` (Etappe 2 — gegenseitige Accountability, eine feste Stufe).

## 4. Migrationen — additiv, idempotent, mit Nachweis

Die DB enthält **echte Trades**. Migrationen sind **handgeschriebenes SQL** in `drizzle/NNNN_*.sql`
(nicht drizzle-kit-generiert) und müssen **additiv und idempotent** sein:

- Spalten: `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`
- Tabellen: `CREATE TABLE IF NOT EXISTS …`, Indizes `CREATE INDEX IF NOT EXISTS …`
- Constraints in einen `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=…) …`-Block
- **Nie destruktiv** (kein DROP/RENAME/Typ-Wechsel auf bestehenden Spalten), **kein Backfill**
  mit erfundenen Werten — Altbestand bleibt leer und wird in Auswertungen als „ohne Angabe"
  behandelt.

**Anwenden** (führt alle Migrationen idempotent aus, liest `DATABASE_URL` aus `.env.local`):
```
node scripts/apply-migration.mjs
```
**Nachweis-Standard** (so gilt eine Migration als „erledigt", vgl. Etappen 1/3/4): vorher und
nachher je einen Dump ziehen und vergleichen — der Trade-Bestand muss unverändert sein:
```
node scripts/baseline-report.mjs .baseline-<name>-vorher   # nur lesend
node scripts/apply-migration.mjs
node scripts/baseline-report.mjs .baseline-<name>-nachher
# dann die trades.json beider Ordner vergleichen (müssen identisch sein)
```
Neue Tabelle/Spalten anschließend gegen `information_schema` prüfen (Spalten, 0 Zeilen,
CHECK-Constraints greifen). Ergebnis in `ROADMAP.md` unter „Nachweis" + „Abweichungen"
dokumentieren.

## 5. Prüfen — nicht über pnpm

`corepack pnpm` **bricht auf diesem Setup ab** (globales pnpm ≠ `packageManager`-Pin), und
`pnpm` ist nicht im PATH. Prüfläufe deshalb direkt über die lokalen Node-Binaries:

```
node node_modules/typescript/bin/tsc --noEmit      # Typen
node node_modules/vitest/vitest.mjs run            # Tests (Vitest)
node node_modules/next/dist/bin/next build         # Build
```

- **ESLint ist nicht installiert** → `pnpm lint` schlägt fehl; es ist *kein* Prüfmittel. Die
  echten Prüfungen sind `tsc --noEmit` und Vitest.
- **Build-Gotcha:** Scheitert `next build` mit `UNKNOWN open …\.next\diagnostics\…` (errno
  -4094) *nach* „✓ Compiled successfully", ist das ein transienter FS-Lock im `Downloads`-Pfad:
  `.next/diagnostics` löschen und erneut bauen. Der Code war schon in Ordnung.
- **Dev-Server:** Meist läuft schon ein `next dev` auf `:3000` — erst `localhost:3000` probieren.

## 6. Design-Tokens & Konventionen

- **Optik:** edel/institutionell „Privatbank-Nacht", App läuft **dark**. IBM Plex (Serif Titel,
  Sans UI, Mono Daten/Kurse). Geldfarben kräftig, **kein Neon/Glow/Sci-Fi**.
- **Farb-Variablen** in `app/globals.css` — im Code die Tailwind-Tokens nutzen
  (`text-positive`, `text-destructive`, `text-warning`, `text-primary`, `bg-primary/10`, …),
  nicht rohe Hex-Werte. Kartenoptik: `.glass-card`. Referenzwerte: BG `#0b1522`, Akzent
  `#45a8ec`, Grün `#4FBE8C`, Rot `#D8505F`, Gold `#D4AC4E`.
- **Sprache:** UI und Texte auf **Deutsch**, Umlaute (ä/ö/ü/ß) immer korrekt.
- **Client-Komponenten** halten keinen eigenen Speicherpfad in die DB — sie rufen die
  Server Actions. Feste Tailwind-Klassen statt String-Interpolation (Tailwind braucht
  statische Namen — siehe die `Record`-Maps in `mood-check.tsx`).

## 7. Wofür was — kurze Wegweiser

- **Struktur-/Abhängigkeitsfragen** („wer ruft `activateTrade`", Auswirkungsradius,
  Datenfluss): **zuerst `mcp__codegraph__codegraph_explore`**, nicht Grep. Grep/Read nur für
  reine Text-/String-Suchen.
- **„Was bauen wir als Nächstes"**: `ROADMAP.md` (Etappen 2–7, je mit Datenmodell, Dateien,
  Nachweis-Fragen), Ideenvorrat in `IDEEN-BACKLOG.md`.
- **Geld-/R-/Positionsmathematik**: existiert in `lib/trade-math.ts` — nicht neu erfinden.
