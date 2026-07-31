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
