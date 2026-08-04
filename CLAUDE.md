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
- **Trade ↔ Instrument:** `createTrade` verknüpft über den **Ticker** und nur im Moment des
  Anlegens; fehlt das Instrument, bleibt `stockId` leer. `addStock` holt die Verknüpfung
  nachträglich für alle unverknüpften Trades desselben Tickers nach — eine bestehende
  Zuordnung wird nie überschrieben. Ohne `stockId` gibt es für den Trade keinen Chart,
  keine Kerzen und keinen Bot-Zwilling.
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
- **Teilziele** (Etappe 13) = mehrere Take-Profits je Trade, geplant **vor** dem Einstieg und
  einzeln ausführbar (Migration `0023`, Tabelle `trade_target`). Ein Staffel-Ausstieg ist
  Douglas-konform, solange die Stufen vorher feststehen — genau deshalb sind sie ein Teil des
  Plans und keine Entscheidung im laufenden Trade. Höchstens `MAX_TARGETS` = 4 Stufen, je Kurs +
  Anteil der **Anfangs**position; die Summe darf unter 100 % bleiben, der Rest läuft dann bis zur
  letzten Stufe (und wird beim gewichteten CRV auch dort gerechnet). Reine Logik in
  `lib/trade-targets.ts` (`normalizeTargets` · `effectiveTargets` · `blendedRiskReward` ·
  `plannedQty` · `targetProgress`, getestet) — Formular und Server prüfen über **dieselbe**
  Funktion. `trade.takeProfit`/`takeProfitPct` sind ab hier die **abgeleitete Schreibweise der
  ersten Stufe** (wie `tradedWithMoney` die von `portfolio.kind` ist), geschrieben nur in
  `createTrade` und `updateTradePlan`; dadurch bleiben alle reinen Rechenfunktionen und der
  gesamte Altbestand unverändert gültig. **Kein Backfill:** Ein Trade ohne Zeilen wird über
  `effectiveTargets` als eine implizite Stufe gelesen. Das gespeicherte `riskRewardRatio` ist bei
  Stufen das **gewichtete** CRV (bei genau einer Stufe identisch mit `computeRiskReward`).
  Ausgeführt wird über `executeTarget` (ein `teilverkauf`-Event, die Stufe zeigt per `eventId`
  darauf); die **letzte** Stufe, die die Position schließt, läuft bewusst über `closeTrade`
  (`targetId`) — an einem vollständigen Ausstieg hängen Verlust-Annahme, Plan-Treue und Check-in.
  Ausgeführte Stufen sind unveränderlich. Oberfläche: `components/target-stages.tsx` (Eingabe,
  gemeinsam für Formular und Bearbeiten-Dialog) und `components/trade-targets-card.tsx`
  (Anzeige + Ausführen) auf `/trades/[id]`; je Stufe ein Kurs-Alert und eine Chart-Linie.
- **Emotions-Check-in** = zwei Momentaufnahmen je Trade (Aktivieren + Abschließen):
  Skala 1–5 (ruhig ↔ aufgewühlt) + Tags aus fester Liste. **Skala ist Pflicht**, Tags/Notiz
  freiwillig. Auswertung „Zustand & Ergebnis" auf `/tracking`; unter 10 Trades je Gruppe
  zeigt sie bewusst keine Quote.
- **Schneller Trade** (Etappe 8) = zweiter Erfassungsweg neben dem vollen. `tradeKind`
  (`langfristig` | `schnell`, Migration `0018`, Default `langfristig`) steht am Trade; die
  beiden Guard-Entscheidungen dazu stehen **nur** in `lib/trade-kind.ts`
  (`requiresPreTradeGate`, `requiresMoodCheck`) — nicht daneben neu entscheiden. Der schnelle
  Weg überspringt die **neun Fragen** und macht den **Check-in freiwillig**; er lässt Elliott,
  Setup, Begründung, Notizen, Broker und die Gebühren-Eingabe weg (Gebühren kommen aus den
  Einstellungen). **Stop und bewusste Verlustannahme bleiben in beiden Wegen Pflicht.**
  `preTradeAnswered` wird dabei **nicht** auf `true` gesetzt — die Daten sollen nicht
  behaupten, die Fragen seien beantwortet worden. Ein schneller Trade trägt sichtbar das
  Abzeichen `SCHNELL`, damit ihm anzusehen ist, dass kein Gate lief.
- **Symbolauflösung & Kurs-Sync** (Etappe 9) = der eingetippte Ticker ist **nicht** das
  Anbieter-Symbol. `stock.ticker` bleibt die Absicht des Nutzers und die Verknüpfung zu den
  Trades; daneben steht `providerSymbol` — das Symbol, das beim Anbieter nachweislich
  existiert (`CL1!` → `CL=F`, `ADS` → `ADS.DE`, `DAX` → `^GDAXI`, `BTCUSD` → `BTC-USD`).
  Migration `0019`. **Nie den Rohticker an einen Anbieter geben** — die Übersetzung läuft
  ausschließlich über `lookupProviderSymbol` (`lib/market-data/lookup.ts`).
  **Primärquelle ist Yahoo** (`lib/market-data/yahoo.ts`, kostenlos, ohne Key, Cookie+Crumb
  holt der Code selbst); Twelve Data und Binance sind nur noch Rückfallebene über
  `providerChain`. Grund: Twelve Datas Gratis-Tier erlaubt 8 Anfragen/Minute und kennt weder
  Terminkontrakte noch Indizes noch XETRA/Euronext/HKEX — bei ~90 Instrumenten strukturell
  nicht bedienbar. Yahoo liefert alles **gebündelt** (ein Request statt 90).
  **Auflösung** in `lib/market-data/resolve.ts` (rein bis auf die Abrufe, getestet): Kandidaten
  aus festen Übersetzungen (`symbol-aliases.ts`), Normalisierungsregeln und Suche über Ticker
  UND Name → **alle** Kandidaten in EINEM Batch gegen echte Kurse prüfen → bewerten →
  entscheiden. Zwei Fragen bleiben strikt getrennt: **welches Papier** (Punktzahl, `isConfident`,
  `AMBIGUITY_MARGIN`) und **welche Börse** (`compareVenues`: deterministischer Alias →
  Karteileiche aussortieren → Tickerwurzel → **Heimatwährung** `currency === financialCurrency`
  → Volumen). Identität zweier Notierungen über `sameInstrument` = Instrumenten**klasse** +
  Tickerwurzel + **Bilanzwährung**, nicht über den Namen (dieselbe Aktie heißt an XETRA
  „Bayerische Motoren Werke AG" und in Zürich „BMW AG"). Status `ok` heißt: für dieses Symbol
  wurde soeben ein Kurs abgerufen — nie „sieht plausibel aus". Unsicheres wird `ambiguous` und
  landet sichtbar in der Watchlist, nie still falsch verknüpft. Handauswahl setzt
  `resolutionPinned`; danach fasst die Automatik das Instrument nicht mehr an.
  **Kurse kommen aus `quote_snapshot`**, nie direkt vom Anbieter — Schlüssel ist das
  Anbieter-Symbol, nicht das Instrument (dasselbe Papier in zwei Watchlists = eine Abfrage).
  `/api/sparklines` liest nur noch aus der DB. Ein Anbieterausfall zeigt den letzten bekannten
  Kurs mit Zeitstempel statt eines leeren Felds. **Synchronisierung** `runSymbolSync`
  (`lib/market-data/sync.ts`): Vercel-Cron `/api/cron/sync-symbols` (Header
  `Authorization: Bearer $CRON_SECRET`), Selbstheilung beim Seitenaufruf über `refreshIfStale`
  (nötig, weil Vercel-Hobby Cron nur 1×/Tag zulässt), Knopf „Kurse aktualisieren", und
  `addStock` löst sofort beim Anlegen auf. Jeder Lauf protokolliert in `symbol_sync_run`.
  Kommandozeile: `node node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs
  scripts/sync-symbols.ts [--dry] [--why] [--force] [--max N] [--ids a,b]`.
  **Näherungen werden ausgewiesen:** Yahoo führt keinen Edelmetall-Spot (`XAUUSD=X` existiert
  nicht) — `XAUUSD` löst auf `GC=F` auf und trägt `resolutionApproximate`, die Watchlist zeigt
  „Näherung".
- **Ein Trade wird über sein INSTRUMENT aufgelöst, nie über seinen Ticker** (Etappe 11).
  `lookupProviderSymbol` sucht über Tickergleichheit — das reicht für die Watchlist, aber
  nicht für Trades: Der Solana-Trade heißt `SOL`, das Instrument dazu `SOLUSD`, und beim
  Anbieter heißt es `SOL-USD`. Yahoo kennt weder `SOL` noch `SOLUSD`. Verbunden sind die
  beiden über `trade.stockId`; genau darüber geht `createSymbolResolver` (`lib/market-data/
  lookup.ts`) — verknüpftes Instrument → Tickergleichheit → Rohticker.
  **Warum das mehr als ein fehlender Chart war:** Yahoo kennt ein *anderes* Papier namens
  `BTC`. Der Rohticker lieferte deshalb keinen Fehler, sondern einen **falschen Kurs von
  28,10 € für eine Bitcoin-Position** (richtig: 63.533,80) — samt falschem R und falschem
  Abstand zum Stop. Ein stiller falscher Wert ist genau das, wogegen diese App gebaut ist.
  Angeschlossen sind: `components/trade-replay.tsx`, `app/actions/bot-twin.ts` (Bot-Zwilling
  UND MAE/MFE), `app/actions/excursion.ts`, `components/live-position.tsx` sowie
  `/api/quote` und `/api/candles` über den optionalen Parameter `stockId`.
  **Wer künftig irgendwo Marktdaten holt, reicht `stockId` mit — ohne ihn ist das Ergebnis
  nicht nur leer, sondern womöglich falsch.**
- **Instrumentenkarte** (Etappe 10) = Prognosen UND Trades desselben Wertes an einer Stelle.
  Die beiden Welten lagen bis dahin auf getrennten Seiten (`/analysis` kannte nur Prognosen,
  `/tracking` nur Trades ohne Instrumentbezug) — damit war die Kernfrage nirgends zu
  beantworten: **Liegt es an der Analyse oder an der Umsetzung?** Genau diese Differenz ist
  die `gap` (Prognosequote − Trade-Trefferquote); positiv = die Analyse trifft besser als die
  Umsetzung, das Problem sitzt im Verhalten. Ein Baustein
  (`components/instrument-card.tsx`) an **vier** Orten: Analyse (ersetzt die frühere
  Rangliste, mit deren Bedienelementen als `footer`), Auswertung, Instrument-Detail (als
  Kopf), Watchlist (Zeile aufklappbar). Ein Ladeweg für alle vier
  (`getInstrumentCards`) — vier eigene Abfragen wären vier Gelegenheiten, dieselbe Kennzahl
  verschieden zu rechnen.
  **Echtgeld und Demo stehen immer getrennt** — eine schöne Quote aus Papertrades ist genau
  die Selbsttäuschung, gegen die die App gebaut ist; bei Demo bewusst **kein** Geldbetrag,
  der wäre erfunden. Die Trefferquote steht immer da, unter `MIN_INSTRUMENT_TRADES` (= 5)
  aber mit ihrer Grundlage darunter: „100 %" aus einem Trade darf nicht aussehen wie aus
  dreißig. Gerechnet wird über `baseBucket`/`tradeNetPnl` aus `lib/trade-stats.ts` statt neu —
  nur so bleibt es event-aware (Teilverkäufe zählen korrekt). Je Instrument ist die
  Trade-Seite heute noch dünn; die belastbare Zahl steht deshalb zusätzlich als
  **Aggregat über alle Instrumente** auf `/tracking` (`overallGap`,
  `components/prognosis-gap-row.tsx`).
- **Trade ↔ Instrument verknüpfen** (`lib/instrument-link.ts`, rein und getestet): zuerst
  exakte Tickergleichheit, sonst über das **aufgelöste Anbieter-Symbol** aus Etappe 9 — so
  findet ein als `BTC` erfasster Trade das Instrument `BTCUSD` (beide → `BTC-USD`). Verknüpft
  wird **nur bei eindeutigem Treffer**, nie geraten. Eingehängt an drei Stellen: `createTrade`,
  Auffangnetz im Hintergrundlauf (`lib/market-data/sync.ts`) und rückwirkend über
  `scripts/link-trades.ts --dry`. Trades ohne Instrument sind erlaubt und fallen aus der Karte
  heraus, statt irgendwo falsch zu landen.
- **Hebel gilt auch auf Papier** (Etappe 11). Einsatz und Hebel stehen in BEIDEN Handelsarten
  im Formular — bei Demo als „Papier-Einsatz". Grund: Wer einen gehebelten Echtgeld-Trade übt,
  übt nur dann etwas Übertragbares, wenn Positionswert und Stückzahl dieselben sind. Deshalb
  speichert `createTrade` `investedAmount` und die daraus abgeleitete `positionSize` jetzt auch
  für Demo-Trades. **Übungsgeld bleibt Übungsgeld:** Gebühren fallen auf Papier keine an
  (`tradeFees`), und jede Geldkennzahl — Bilanz, Equity, Drawdown, Risiko-Guard — filtert
  unverändert auf `tradedWithMoney`. Das R-Vielfache ist von der Stückzahl unabhängig (Gewinn
  und Risiko skalieren gleich), Disziplin- und Erwartungswert-Kennzahlen ändern sich dadurch
  also nicht. Der Einsatz ist optional: Ohne Angabe verhält sich ein Demo-Trade wie bisher.
- **Kursfrische** (Etappe 11): Kurse kommen aus `quote_snapshot`, gefüllt vom Cron-Lauf — der
  auf Vercel-Hobby aber nur **einmal täglich** darf. Damit trotzdem nichts veraltet, fragt die
  offene Seite im Minutentakt nach und der Server holt nach, sobald der Speicher älter als
  `QUOTE_STALE_MS` (2 Minuten) ist: `refreshQuotesIfStale` in `lib/market-data/sync.ts`,
  aufgerufen von `/api/sparklines` (Watchlist) und der Serveraktion `refreshQuotes` über
  `components/quote-auto-refresh.tsx` (Analyse, Auswertung, Instrument-Detail).
  **Takt ≠ Anbieteranfrage:** Eine Minute Takt heißt „höchstens so alt darf das Angezeigte
  werden", geholt wird höchstens alle zwei Minuten — und dann alle Symbole in EINER
  Yahoo-Anfrage. Eine Klammer (`inFlightRefresh`) verhindert parallele Läufe.
  Im Hintergrundtab pausiert der Takt (`visibilitychange`); der **erste** Abruf läuft immer,
  sonst stünde eine im Hintergrund geöffnete Seite dauerhaft auf „…".
- **Einstiegs-Signal** (Etappe 14) = die App meldet sich von selbst, wenn ein geplanter Trade
  seinen Einstieg erreicht. Vier Teile, die zusammengehören:
  **(1) Serverseitige Prüfung.** `runAlertCheck` in `lib/alert-run.ts` — sitzungsfrei, damit
  die Cron-Route sie für alle Nutzer anstoßen kann; `checkAlerts()` delegiert nur noch dorthin
  (zwei Auslöse-Implementierungen wären zwei Wahrheiten darüber, wann ein Level erreicht ist).
  Zwei Kursquellen mit Absicht: `quote_snapshot` (frisch, Batch, nur Schlusskurs) UND die
  letzte Kerze (bis 15 Min alt, dafür High/Low für Intra-Kerzen-Berührungen) — ausgelöst wird,
  wenn EINE der beiden das Level erreicht sieht.
  **(2) Zustellung.** `lib/notify/agentmail.ts` (HTTP-API, `AGENTMAIL_API_KEY` +
  `AGENTMAIL_INBOX_ID`), Text rein und getestet in `lib/notify/alert-mail.ts`. Gesendet wird
  nur für `triggeredAt != null AND notifiedAt IS NULL` — ein Versandfehler lässt `notifiedAt`
  leer und wird beim nächsten Lauf erneut versucht, ein zweiter Lauf schickt nie dieselbe Mail.
  **Takt von außen** (`.github/workflows/check-alerts.yml`, alle 5 Min): Vercel-Hobby lässt nur
  EINEN Cron-Lauf pro Tag zu. Weil dieser Takt nicht der App gehört, zeigen die Einstellungen
  „letzter Prüflauf: vor X Minuten" (`alert_check_run`, `lib/notify/status.ts`) — ein
  Warnsystem, das seinen eigenen Ausfall verschweigt, ist schlimmer als keines.
  **(3) Der Moment.** `/trades/[id]/einstieg` (`components/entry-moment.tsx`): Plan, Kurs mit
  Zeitstempel, ein Douglas-Satz und zwei **gleich große** Wege. Aktivieren und Verwerfen laufen
  über die BESTEHENDEN Dialoge aus `trade-card.tsx` (`ActivateDialog`/`NoTradeDialog`) — ein
  zweiter Aktivieren-Weg wäre eine zweite Stelle, an der Gate, Guard und Check-in hängen.
  Ein Trade, der nicht mehr `geplant` ist, wird auf die volle Trade-Ansicht umgeleitet.
  **(4) Wecker automatisch** (`trade.alertsEnabled`, Migration `0025`): beim **Anlegen** der
  Einstiegs-Wecker, beim **Aktivieren** Stop und Ziele. Vorher entstanden Alerts nur beim
  Aktivieren und nur mit gesetztem Häkchen — ein wartender Plan hatte also nie einen
  Einstiegs-Wecker. Welche Arten zum Stand passen, entscheidet `kindsForStatus`; nach einer
  Planänderung zieht `syncPlanAlertsAfterEdit` sie nach. Altbestand nur auf Knopfdruck
  (`createMissingPlanAlerts`). Migration `0024` stellt alle vor der Etappe ausgelösten Alerts
  einmalig still — sonst hätte der erste scharfe Lauf Monate alter Marken auf einen Schlag
  verschickt.
- **Abstand zum Einstieg** (Etappe 14) = die Ordnung der Watchlist. `lib/entry-distance.ts`
  (rein, getestet): je Instrument der NÄCHSTE geplante Einstieg, erreichte zuoberst, dann nach
  Abstand, alles ohne Plan alphabetisch darunter. **Bewusst über alle Depots** — anders als die
  Kennzahlen daneben: Der Abstand ist keine Geldkennzahl, sondern eine Frage der Aufmerksamkeit,
  und der Wecker meldet ohnehin depotübergreifend. `/api/sparklines` antwortet seither in zwei
  Zügen (`?closes=1`): erst der Kurs aus der Datenbank, dann die Verläufe mit bis zu neunzig
  Kerzen-Abrufen — vorher wartete der Kurs auf das Beiwerk (5–10 Sekunden leere Felder).
- **Replay-Trainer** (Migration `0026`) = Charts zurückspulen und die eigene Analyse messen.
  Drei Tabellen, weil drei Zeitpunkte: `training_session` (die Übung **samt der vor dem
  Aufdecken festgeschriebenen These**, `committedAt`), `training_annotation` (die Zeichnungen
  dazu) und `training_result` (die Bewertung danach, genau eine je Übung). Läge alles in
  einer Zeile, ließe sich nicht mehr belegen, dass die These vor dem Ergebnis stand — und
  eine nachträglich anpassbare These misst nichts. Genau deshalb ist die Sperre auch keine
  Warnung, sondern eine **Obergrenze am Replay** (`replayMaxVisible`): Vor dem Festschreiben
  gibt der Chart keine einzige Kerze frei. Drei Modi (`lib/training.ts`): `frei` ·
  `zufall` · `elliott` (dort sind Wellenzählung und Invalidation Pflicht). Die beiden
  letzten sind **verdeckt** — und zwar echt: Der Chart fragt mit `trainingSessionId` an,
  `/api/candles` nimmt Symbol/Markt/Intervall aus der Übung und gibt sie **erst nach dem
  Aufdecken** zurück; dazu verschwindet die **Zeitachse** (ein Datum verrät den Ausschnitt
  fast so gut wie der Ticker). Bewertet wird `korrekt | teilweise | falsch` plus Fehler aus
  einem **festen** Katalog (anders als die frei benannten Setup-Tags — nur ein fester
  Katalog lässt sich über Monate zählen). Auswertung `computeTrainingStats`
  (`lib/training-stats.ts`, rein, getestet) auf **`/trainer/statistik`**, bewusst getrennt
  von `/tracking`: Eine Übungsquote ist keine Handelsbilanz. Schwellen `MIN_TRAINING_RUNS`
  = 10 und `MIN_TRAINING_BUCKET` = 5, darunter steht die Grundlage statt einer Quote.
  Übungszeichnungen landen **nie** in `chart_drawing` — sie gehören zum historischen
  Ausschnitt, nicht zum Instrument. Der Replay selbst läuft zusätzlich in **jedem**
  Watchlist-Chart (`components/chart/instrument-chart.tsx`) und ungemessen unter
  `/trainer/frei`. Zeitebene → Intervall steht seither einmal in `lib/chart-timeframes.ts`
  (auch der Server braucht sie).
- **Kerzenspeicher** (Migration `0027`) = was einmal geholt wurde, bleibt liegen. Vorher lag
  vor den Anbietern nur ein `unstable_cache` (15 Min, prozessweit, nach jedem Neustart leer);
  damit galt für die Historie immer das, was Yahoo GERADE hergibt — bei 15-Minuten-Kerzen ein
  Fenster von **60 Tagen**. Der Speicher wächst über dieses Fenster hinaus, also über das,
  was die Quelle selbst noch kennt. Tabellen: `candle_cache` (Schlüssel
  **Anbieter-Symbol + Intervall + Zeit**, bewusst **ohne `userId`** — eine Kerze ist keine
  Nutzerdatei, sondern eine öffentliche Marktbeobachtung, dieselbe Entscheidung wie
  `quote_snapshot`), `candle_series` (Abdeckung je Reihe **und** wann zuletzt geholt — daran
  hängen Frischeprüfung und Rotation) und `candle_collect_run` (Protokoll).
  **`getCachedCandles` ist weiterhin der einzige Weg zu Kerzen**, liest aber jetzt zuerst die
  Datenbank (`lib/market-data/candle-store.ts`); die reine Logik steht in `candle-merge.ts`
  (`mergeCandles` · `candlesToWrite` · `isFresh` · `orderByStaleness` · `isDueForCollection` ·
  `summarizeCoverage`, getestet). **Bei gleichem Zeitstempel gewinnt immer der frische Satz** —
  die letzte Kerze einer Reihe läuft noch. **Fällt der Anbieter aus und es liegen Kerzen vor,
  kommen die Kerzen**, nie ein leerer Chart. Gesammelt wird über
  `/api/cron/collect-candles`, angestoßen vom **bestehenden 5-Minuten-GitHub-Takt**; die Route
  entscheidet **selbst**, ob sie fällig ist (`RUN_INTERVAL_MS`, 1 h) und bricht nach
  `TIME_BUDGET_MS` = 45 s von selbst ab — Vercels `maxDuration` von 60 s würde sie sonst
  mitten im Schreiben abschneiden. Staffel: 15m/30m/1h täglich (dort läuft die Historie beim
  Anbieter davon), alles darüber wöchentlich. **Speicherbedarf: rund 138 Bytes je Kerze**
  (gemessen: 426.000 Kerzen = 56 MB); bei ~90 Instrumenten über alle Zeitebenen sind rund
  200 MB zu erwarten, plus etwa 0,6 MB je Tag Zuwachs.
  **Wer die ausgelieferte Kerzenzahl ändert, muss an Positionen denken, die als Index
  gespeichert sind:** Eine Trainingseinheit findet ihren Startpunkt deshalb über die **Zeit**
  ihrer Startkerze (`startCandleTime`), nicht über `startIndex` — sonst zeigt dieselbe Übung
  nach jedem Zuwachs an Historie eine andere Stelle. `DELIVERY_LIMIT` (was ein Chart bekommt)
  und `DEFAULT_OUTPUT_SIZE` (was beim Anbieter angefragt wird) sind seither getrennt.
- **Replay-Sitzung mit mehreren Trades** (Migration `0029`) = die zweite Ausbaustufe des
  Trainers. Vorher war eine Übung: eine These, einmal aufdecken, eine Bewertung. Das misst die
  **Analyse**, nicht das **Handeln** — im Markt trifft man nicht eine Entscheidung, sondern eine
  Folge davon. Ab hier ist `training_session` der Replay-**Durchlauf**, darin liegen beliebig
  viele `training_trade` (höchstens `MAX_SESSION_TRADES` = 20). **Gezählt wird der Trade, nicht
  die Sitzung** — zehn Trades in einer Sitzung sind zehn Entscheidungen; `getTrainingStats`
  liefert deshalb je Trade eine `TrainingRunRow`, `computeTrainingStats` blieb unverändert.
  **Alt-Übungen zählen weiter** als Sitzung mit genau einem Trade (erkannt an
  `trainingSession.direction != null`, dann läuft auch die alte Oberfläche) — **kein Backfill**,
  ihre Daten werden gelesen, nie kopiert.
  **Gemessen statt geschätzt:** `outcome`/`rMultiple` rechnet `measureOutcome`
  (`lib/training-trade.ts`, rein, getestet) aus den Kerzen; die Trefferentscheidung kommt aus
  `candleReachesLevel` (`lib/alerts.ts`) — derselben Quelle wie Bot-Zwilling und Kurs-Alerts.
  Stop und Ziel in derselben Kerze → konservativ der **Stop**, ausgewiesen als `ambiguous`.
  `rating`/`errorTags` bleiben daneben die **eigene** Einordnung: Ein Trade kann sein Ziel
  erreichen und die Zählung trotzdem falsch gewesen sein.
  **Erkannt wird im Browser über die SICHTBAREN Kerzen, gemessen auf dem Server.** Es gibt
  bewusst **keinen** „jetzt messen"-Knopf: Der Server misst über die volle Historie, das wäre
  auf Knopfdruck eine Abkürzung zum Ergebnis, bevor man es aufgedeckt hat. Erst
  `endTrainingSession` misst den Rest — dann ist nichts mehr zu verbergen.
  **Haltepunkte** (`stopMode` `auto`|`manuell` + `stopEvery`, gewählt **einmal** beim Anlegen):
  `nextStopAt` begrenzt den Replay auf die nächste Marke. Ohne offenen Trade lautet die Frage
  „siehst du hier ein Setup?" — die Neins landen in `training_checkpoint` **ohne `tradeId`** und
  sind die einzige Zahl gegen **Überhandeln**; ohne sie sähe man nur die Trades, die entstanden
  sind, nie die verkniffenen. Enthaltungen (`direction = 'keine'`) zählen **nicht** in die
  Trefferquote — würden sie als Fehlschlag zählen, wäre die sicherste Strategie, immer
  irgendetwas zu handeln. **Pflicht bleiben Einstieg, Stop und Ziel**, sobald eine Richtung
  steht (`validateTradeDraft`, gemeinsam für Formular und Server): ohne sie ist nichts messbar.
  Der **Auftrag je Modus** steht in `TRAINING_TASKS` (`lib/training.ts`) — ohne ausgesprochene
  Aufgabe sieht man ein Formular und weiß nicht, was man leisten soll.
  **Was das Eingreifen kostet** (`computeInterventionCost`, rein, getestet) = der eigentliche
  Ertrag der Haltepunkte und der Grund, warum sie überhaupt gespeichert werden. Wer „ich wäre
  raus" sagt und der Trade läuft danach ins Ziel, hat genau den Douglas-Kernfehler gemacht:
  aus einem plan-konformen Trade auszusteigen, weil es sich unangenehm anfühlte. Gezeigt wird
  je Sitzung („3× wolltest du raus, davon 2 Trades, die danach das Ziel erreichten — 3,4 R
  hätte das gekostet"), geladen über `getSessionReview`. Je Trade zählt **ein** Ausstiegswunsch.
  Der Block **beobachtet**, er ordnet nichts an — derselbe Ton wie bei MAE/MFE.
  **Der Plan liegt als Linie IM Chart** (`planLines`, `PLAN_COLORS`): Man sieht den Kurs auf den
  eigenen Stop zulaufen, statt Zahlen zu vergleichen — das ist der einzige Grund, warum ein
  Replay etwas anderes ist als eine Tabelle. Der Einstieg ist mit dem sichtbaren Schlusskurs
  vorbelegt (gerundet nach Größenordnung), und CRV plus Stop-Abstand stehen live im Formular
  (`computeRiskReward` aus `lib/trade-math.ts`, nicht neu gerechnet).
  **Tastatur am Replay** (`chart-replay-controls.tsx`): Leertaste spielt/hält, ← → gehen Kerze
  für Kerze, mit Umschalt in Zehnerschritten. Beim Üben liegt der Blick auf dem Chart — jeder
  Griff zur Maus unterbricht genau das Lesen, das geübt werden soll.
  **Levels aus dem Chart nehmen** (`pickPrice`/`pickLabel` am `PriceChart`, `PickField` in
  `lib/training-trade.ts`): Fadenkreuz-Knopf am Feld → eine Ebene legt sich über den Chart
  (z-30, **über** der Zeichenebene, sonst entstünde eine Zeichnung), eine Linie folgt dem
  Zeiger, der Klick übernimmt den Kurs; Esc bricht ab. So setzt man den Stop dorthin, wo die
  Struktur ihn verlangt, statt ihn von der Achse abzulesen. Der Zustand liegt im **Arbeitsplatz**,
  weil Chart und Formular ihn beide brauchen — zwei Kopien wären zwei Meinungen darüber, worauf
  der nächste Klick geht. Vorschau und übernommener Wert runden **gleich** (`alsKurs`, nach
  Größenordnung: ≥100 → 2 Stellen, ≥1 → 4, sonst 6).
  **Beim Treffer hält der Replay an** und meldet ihn (`setFreigabe(visible)` + Toast): Der
  Moment, in dem der Plan aufgeht oder scheitert, ist der lehrreichste der Übung —
  darüber hinwegzuspielen wäre der eine Fehler, den die Oberfläche nicht machen darf.
  **MAE/MFE je Sitzung** über `computeExcursion` (`lib/excursion.ts`, nicht neu gerechnet),
  **live und ohne Migration**: abgeleitete Werte aus Plan + Kerzen; eine Spalte dafür wäre eine
  zweite Wahrheit, die beim ersten Nachladen von Historie auseinanderliefe.
  **`/trainer/statistik` hat zwei Hälften:** `TrainingStatsPanel` beantwortet „lag ich richtig"
  (die **Analyse**), `BehaviourPanel` (`getTrainingBehaviour`) beantwortet „habe ich meinen
  eigenen Plan gehandelt" (das **Verhalten**) — über alle Sitzungen hinweg, weil eine einzelne
  nur Zufall zeigt. Unter `MIN_BEHAVIOUR_TRADES` = 5 steht die Grundlage statt einer Aussage.
  Dateien: `lib/training-trade.ts` · `app/actions/training-trades.ts` ·
  `components/trainer/{session-panel,trade-plan-form,trade-verdict-form}.tsx`.
- **Chart-Aussehen** (Migration `0028`) = wie die Charts aussehen, gehört dem Nutzer, nicht dem
  Design. Dreizehn Werte (Hintergrund · Kerzenkörper · Ränder · Dochte · Gitter · Achsenschrift
  · Achsenlinie · Akzent · Gitter an/aus · Hohlkerzen) in `user_settings.chartAppearance` als
  **JSON in einem Textfeld** — je Wert eine Spalte hieße: jede weitere Einstellung ist eine
  weitere Migration. Gelesen wird **ausschließlich** über `normalizeAppearance`
  (`lib/chart-appearance.ts`, rein, getestet): Jedes Feld wird einzeln geprüft, Ungültiges und
  Fehlendes fällt auf den Standard — eine ältere gespeicherte Einstellung bleibt nach einer
  Erweiterung gültig, statt den Chart schwarz zu lassen. Farben werden gegen ein Muster geprüft,
  **bevor** sie in Canvas-Eigenschaften gehen; ein ungültiger Wert lässt die Serie sonst still
  ungefärbt und der Fehler wird dann im Chart gesucht statt in den Einstellungen.
  **Kein Backfill:** NULL = Auslieferungszustand (`DEFAULT_APPEARANCE`, „Indigo-Nacht"), es
  sieht also für alle unverändert aus. Die vier früheren festen Paletten in `price-chart.tsx`
  (App/TradingView je hell und dunkel) und der `TV`-Umschalter samt `localStorage` sind damit
  **entfallen** — TradingView ist jetzt eine von vier **Vorlagen** im Dialog
  (`components/chart/chart-settings.tsx`), und jeder Wert ist danach einzeln änderbar.
  Warum in der DB und nicht im Browser: Eine Übung, die auf dem zweiten Rechner anders aussieht
  als der Ernstfall, übt das Falsche.
- Guards: **Pre-Trade-Gate** (alle 9 = "ja" nötig zum Aktivieren; **entfällt beim schnellen
  Trade**) · **Plan-Lock**
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
  · Etappe 8 „Schneller Trade" (Migration `0018`, Spalte `tradeKind`; zweiter Erfassungsweg
  ohne Fragen-Gate, `lib/trade-kind.ts`)
  · Etappe 9 „Symbolauflösung und Kurs-Synchronisierung" (Migration `0019`, Auflösungsspalten
  am `stock` + Tabellen `quote_snapshot` und `symbol_sync_run`; Yahoo als Primärquelle,
  `lib/market-data/{yahoo,resolve,symbol-aliases,sync,lookup}.ts`, Cron-Route, Reparatur-Dialog
  in der Watchlist. **Mit Backfill:** alle 93 Instrumente wurden aufgelöst und tragen Kurse)
  · Etappe 10 „Instrumentenkarte" (Migration `0020`, nur Indizes; `lib/instrument-link.ts`,
  `lib/instrument-stats.ts`, `lib/link-trades.ts`, `components/instrument-card.tsx` +
  `-grid.tsx`, `components/prognosis-gap-row.tsx`, `app/actions/instruments.ts`. Die frühere
  Prognose-Rangliste `components/stock-ranking.tsx` ist damit entfallen)
  · Etappe 11 „Hebel auf Papier und Kursfrische" (keine Migration; Einsatz/Hebel auch für
  Demo-Trades, `components/quote-auto-refresh.tsx` + `refreshQuotesIfStale`)
  · Etappe 12 „Depots" (Migration `0022`, Tabelle `portfolio` + `portfolioId` an `trade`/
  `cashflow` + `activeScope` an `user_settings`; Echtgeld und Übung strikt getrennt,
  `lib/portfolio-scope.ts` + `lib/portfolio-context.ts` + `app/actions/portfolios.ts`.
  **Mit Backfill:** je Nutzer ein Hauptdepot und ein Demo-Depot, Trades nach
  `tradedWithMoney` verteilt)
  · Etappe 13 „Teilziele" (Migration `0023`, Tabelle `trade_target`; mehrere Take-Profits je
  Trade, vorher geplant und einzeln ausführbar, `lib/trade-targets.ts`. **Ohne Backfill**).
  · Etappe 14 „Einstiegs-Signal" (Migrationen `0024` + `0025`: `price_alert.notifiedAt`,
  `user_settings.notifyEmail/notifyByEmail`, Tabelle `alert_check_run`, `trade.alertsEnabled`.
  Serverseitige Alarmprüfung + Mailversand + Einstiegs-Ansicht + automatische Plan-Wecker +
  Abstand zum Einstieg in der Watchlist + Gliederung von `/tracking`. **Mit Backfill:** alle
  vor der Etappe ausgelösten Alerts gelten als gemeldet).
  · **Replay-Trainer** (Migration `0026`, Tabellen `training_session` + `training_annotation`
  + `training_result`; Replay in jedem Chart, Zufallschart mit verdecktem Instrument,
  festgeschriebene These, Bewertung und Trainingsstatistik — `lib/training.ts` +
  `lib/training-stats.ts` + `lib/chart-timeframes.ts`, Seiten `/trainer`, `/trainer/[id]`,
  `/trainer/frei`, `/trainer/statistik`. **Ohne Backfill**, es gab nichts nachzutragen)
  · **Kerzenspeicher** (Migration `0027`, Tabellen `candle_cache` + `candle_series` +
  `candle_collect_run`; Yahoos echte Grenzen ausgereizt — 15m von 30 auf 60 Tage, 1h von
  3 Monaten auf 2 Jahre —, dauerhafter Speicher davor, Sammellauf am GitHub-Takt,
  Abdeckungsanzeige im Trainer. **Ohne Backfill**, der Speicher füllt sich ab dem ersten
  Abruf).
  **Die Roadmap ist damit vollständig** — offen ist nur noch der Ideenvorrat in
  `IDEEN-BACKLOG.md`.

## Mobil: geprüft und die Fallstricke, die dabei auftauchten (Etappe 14)
Die App war nie auf einem schmalen Display geprüft worden. Elf Seiten bei 390 px hatten am
Ende **null** horizontale Überbreite; gefunden und behoben wurden dabei:
- **Die Kopfzeile über allen Seiten.** Logo + sieben Navigationsziele + Depot-Umschalter +
  Abmelden brauchen ~620 px. Sie ist jetzt unter `sm` zweizeilig (`components/cockpit-header.tsx`),
  die Navigation als eigene Zeile — kein Menü, weil das jeden Seitenwechsel um einen Griff
  verlängert hätte.
- **`overflow-x-auto` allein genügt nicht.** Ein Grid-/Flex-Kind bläht sich auf seine
  Inhaltsbreite auf; der scrollbare Container braucht zusätzlich `min-w-0`, sonst schiebt die
  Tabelle die ganze Seite. Betrifft alle fünf Tabellen-Panels auf `/tracking`.
- **`shrink-0` an einem langen Text** (`StatRow`-Zusatz in `instrument-card.tsx`) schob die
  Seite um 75 px — auf `/analysis` UND `/tracking`, weil derselbe Baustein an vier Orten steht.
- Prüfen lässt sich das **nicht** über `resize_window` des Browser-MCP: Das Fenster schrumpft,
  der Viewport folgt nicht (`innerWidth` bleibt stehen). Zuverlässig geht es über ein iframe
  mit fester Breite — darin greifen die Media-Queries echt.

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
- **`position: fixed` funktioniert in dieser App nicht „einfach so" — zwei Fallen hintereinander.**
  Beide zusammen haben dafür gesorgt, dass die Werkzeug-Menüs des Charts rund 1200 px unterhalb
  ihres Knopfes landeten (teils außerhalb des Bildes) — und weil sie *irgendwo* sichtbar waren,
  sah es nach „das Werkzeug ist kaputt" aus statt nach einem Positionierungsfehler.
  **(1) `.rise-in` macht jedes Panel zum Bezugsrahmen.** Die Animation hinterlässt
  `transform: matrix(1,0,0,1,0,0)` — also *nicht* `none`. Ein Element mit `transform` ist der
  Containing Block für `fixed` darin. Ein Menü im Chart-Panel richtet sich damit nach dem Panel,
  nicht nach dem Fenster. **Lösung: `createPortal(..., document.body)`.**
  **(2) `body > * { position: relative }` (`globals.css`) schlägt die Utility `.fixed`.** Die
  Regel liegt **außerhalb** der Tailwind-Layer, und ungelayertes CSS gewinnt gegen gelayerte
  Utilities *unabhängig von der Spezifität*. Ein Portal-Kind von `<body>` wird dadurch
  `relative`, und `top` zählt plötzlich als Fluss-Versatz. **Lösung: `position: 'fixed'` inline
  setzen** (Inline schlägt beides). Vorbild: `components/chart/chart-toolbar.tsx` und
  `components/chart/chart-settings.tsx`. Wer ein Overlay im Chart baut, braucht **beides**.
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
- **`CRON_SECRET` muss gesetzt sein** (`.env.local` **und** Vercel-Projekt-Einstellungen), sonst
  antwortet `/api/cron/sync-symbols` mit 500 und die Kurse veralten. Ein fehlendes Geheimnis
  fällt sonst nirgends auf — die Watchlist zeigt weiter den letzten bekannten Stand.
- **Vercel-Hobby lässt Cron nur einmal täglich laufen — und lehnt sonst das GANZE Deployment
  ab.** Nicht nur den Cron: Ein `vercel.json` mit `*/15 …` scheitert mit „Deployment failed"
  (Link führt auf *Cron Jobs · Usage and Pricing*), und die Änderung geht gar nicht erst live.
  Genau das ist am 28.07.2026 passiert und blieb zwei Tage unbemerkt, weil lokal alles baute.
  `vercel.json` enthält deshalb **einen** täglichen Lauf (`0 6 * * *`). Wer auf Pro wechselt,
  darf ihn enger stellen — vorher nicht. Die Aktualität zwischen den Läufen trägt ohnehin
  `refreshQuotesIfStale` (Selbstheilung, solange eine Seite offen ist).
- **Nach einem Push prüfen, ob Vercel wirklich gebaut hat** — ein grüner lokaler Build sagt
  darüber nichts. Schnellster Weg ohne Vercel-Zugang:
  `gh api repos/<owner>/<repo>/commits/<sha>/status --jq '.statuses[] | "\(.state) \(.description) \(.target_url)"'`.
  Die `target_url` ist bei Fehlern ein `vercel.link`, das direkt auf die Ursache zeigt.
- **Wer `QUOTE_STALE_MS` senkt, senkt nicht den Takt, sondern die Untergrenze.** Der Takt
  steht in `POLL_MS` (Watchlist-Grid und `quote-auto-refresh.tsx`). Beide zusammen bestimmen,
  wie oft Yahoo wirklich Verkehr sieht — beim Ändern immer beide anschauen.
- **Yahoo ist inoffiziell.** Der Batch-Kursendpunkt braucht Cookie + Crumb; bei 401/403 holt
  `yahoo.ts` beides genau einmal neu. Bricht Yahoo dauerhaft weg, greift `providerChain` auf
  Twelve Data/Binance zurück — die können aber weder Terminkontrakte noch Indizes noch die
  Heimatbörsen, also bleiben dort Lücken. Das ist bekannt und bewusst.
