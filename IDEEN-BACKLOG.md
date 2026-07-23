# Ideen-Backlog (Vollständig, aus der Analyse vom 23.07.2026)

Der komplette Katalog möglicher Erweiterungen. Reihenfolge innerhalb der Blöcke ist grob nach
Wert sortiert. Jede Etappe ist ein eigener Arbeitsschritt — hier wird abgehakt, was erledigt ist.

**Erledigt:** Etappe 1 (Geld-Fundament) — eingefrorene Gebühren, Ausstiegskurs-Pflicht,
Kontowährung, Hebel je Trade, Cashflows, Tests.

**Als Nächstes:** Etappe 2 (Freunde) · Etappe 3 (Live-Kurse + Alerts) · Etappe 4
(Emotions-Check-in) · Etappe 5 (Bot-Zwilling) · Etappe 6 (Teilverkäufe + Event-Log) ·
Etappe 7 (Statistik-Ausbau).

## A · Kern & Datenmodell
- Cashflows (Ein-/Auszahlungen) → **in Etappe 1**
- Hebel, Kontowährung, konfigurierbare Gebühren → **in Etappe 1**
- Teilverkäufe & mehrere Ziele (TP1/TP2/TP3) — `takeProfitPct` ist heute nur eine Projektion
- Pyramidisieren (Nachkaufen) mit gewichtetem Durchschnittseinstieg
- `trade_event`-Tabelle (Stop verschoben, teilverkauft, Notiz) statt `ruleViolations`-JSON
- Trailing-Stop als Plan-Typ (regelbasiert = kein Regelbruch)
- Mehrere Depots/Konten mit je eigenem Startkapital, Währung, Broker
- Instrumenten-Metadaten: ISIN, Börse, Währung, Tick-Size, Pip-Wert (Forex braucht das)
- Broker-Profile mit Gebührenmodell (fix / prozentual / Min-Max)
- Echte Mehrwährung: Instrumentenwährung + eingefrorener FX-Kurs
- Steuersicht Deutschland: KapESt + Soli, Verlusttopf, Termingeschäfte-Grenze, FIFO
- Hebel-Ausbau: Liquidationspreis, Funding-Rate, Übernachtzinsen (sobald gehebelt gehandelt wird)

## B · Disziplin & Psychologie (Douglas-Kern)
- **Emotions-Check-in** vor/nach dem Trade (Skala + Tags: FOMO, Rache, Langeweile, Angst) → später: „Deine FOMO-Trades haben −0,4R Erwartungswert"
- **Zeitschloss am Gate**: nach den 9 Fragen erst nach X Minuten aktivierbar
- **Die 20er-Serie**: 20 Trades exakt nach einem Setup, keine Änderungen, Fortschrittsbalken
- **Tages-Circuit-Breaker**: nach X R Verlust oder Y Regelbrüchen sperrt die App neue Trades
- **Portfolio-Heat**: Summe offener Risiken in % des Kontos mit Warnschwelle
- **Korrelations-Warnung**: „3 offene Longs im gleichen Sektor = ein Trade, nicht drei"
- **Blind-Modus**: P&L für 30 Tage ausblendbar, nur Disziplin-Score sichtbar
- **Gefährlicher Gewinn**: Popup beim Erfassen, wenn Gewinn trotz Regelbruch (Bucket existiert bereits in `/tracking`)
- Eigener Regel-Editor: Nutzer definiert Regeln, App macht Gates daraus
- Fehler-Taxonomie: eigener Fehlerkatalog, Häufigkeit über Zeit
- Pflicht-Post-Mortem: Was war der Plan? Was habe ich getan? Was war Zufall?
- Kontextsensitive Douglas-Zitate (nach Verlustserie andere als nach Gewinnserie)

## C · Auswertung & Statistik
- **Monte-Carlo-Simulator** aus eigener Trefferquote und R-Verteilung → „Eine Verlustserie von 6 ist bei dir in 34 % der Fälle normal"
- **Was-wäre-wenn**: „Alle Trades ohne Regelbruch" vs. real → eine Zahl: was Undiszipliniertheit gekostet hat
- Setup-Vergleich: `strategy` von Freitext zu Tags, dann Erwartungswert je Setup
- MAE/MFE: sind die Stops zu eng oder die Ziele zu nah?
- Zeit-Heatmap: Wochentag × Tageszeit
- Haltedauer vs. Ergebnis
- R-Verteilungs-Histogramm statt nur Durchschnitt
- Profit-Faktor, Payoff-Ratio, Sharpe, Recovery-Faktor
- Kelly-Kriterium aus eigener Historie
- Verhalten nach Verlusten: „Nach 2 Verlusten riskierst du im Schnitt 1,8× so viel"
- Ehrlicher Benchmark: dein Konto vs. Buy & Hold derselben Instrumente
- Elliott-Auswertung: welcher Wellengrad trifft am besten?

## D · Chart
- **Level im Chart ziehen → zurück ins Formular** (steht im Masterplan als optionaler Ausbau)
- **Alerts** (Browser-Notification): das „setzen & weggehen"-Feature
- **Chart-Replay Bar-by-Bar**: Training ohne Geld, an das Journal gekoppelt
- Auto-Screenshot beim Planen → Vorher/Nachher im Trade
- Abgeschlossene Trades als Marker in der Chart-Historie
- Multi-Timeframe-Grid (4 Zeitebenen nebeneinander)
- VWAP / Volumenprofil (aus vorhandenen Kerzen, kostenlos)
- Watchlist zeigt Distanz zum Entry („noch 2,1 % bis zum Einstieg")

## E · Social
- Freundschaft mit Einladungscode + 3 Sichtbarkeitsstufen → **Etappe 2**
- Accountability-Partner: quittiert deine Regelbrüche
- Anonyme Liga — Ranking nach **Disziplin-Score, niemals nach Rendite**
- Peer-Review-Gate: Freund gibt den Plan frei, bevor du aktivierst
- Read-only Journal-Link mit Token (für einen Mentor, ohne Account)
- Mentor-Modus: Coach kann Regeln vorgeben, die bei dir zu Gates werden
- Gruppen-Challenge: „30 Tage kein Regelbruch"
- Geteilte Setup-Bibliothek (Setups, nicht Meinungen)

## F · Automatisierung & Integration
- **Broker-CSV-Import** (IBKR, Trade Republic, Bitpanda) — größter Zeitgewinn überhaupt
- **Sprach-Journal**: Notiz diktieren → Whisper (`whisper-large-v3-turbo`, `language: de`) → Notizfeld
- **Obsidian-Export**: Journal als Markdown in den Vault
- Telegram-Bot: Alerts empfangen, Status abfragen
- Wirtschaftskalender + Earnings-Warnung als Risikohinweis (nicht als Prognosefutter)
- KI-Coach: LLM liest **nur eigene Daten**, liefert den Wochenreview über den Prozess
- Zweiter Datenprovider als Fallback (Twelve Data Free ist heute Single Point of Failure)
- Auto-Backup der Datenbank
- CSV-**Import** (Export existiert, Import fehlt → keine Migration möglich)

## G · Handwerk & UX
- Tests für die Geldmathematik → **in Etappe 1**
- PWA + Push
- Trade-Vorlagen pro Setup → Erfassung in 10 Sekunden
- Command-Palette + Tastatur-Shortcuts
- Onboarding mit Demo-Daten
- Undo für Löschungen

## H · Die wilde Abteilung
- **Der Bot-Zwilling** → Etappe 5. Ein Algorithmus handelt deinen Plan mechanisch nach. Monatsende: „Bot +12R, du +4R — die Differenz ist dein Preis für Emotionen." Von allem hier das stärkste Feature.
- **Das Karma-Ledger**: jeder Gewinn gelabelt „verdient" (plan-konform) oder „geschenkt" (Glück) → zweite Equity-Kurve nur mit verdientem Kapital
- **Der Anwalt der Gegenseite**: vor Aktivierung das beste Gegenargument aufschreiben, beim Schließen wird es gezeigt
- **Zeitkapsel**: beim Öffnen einen Brief ans zukünftige Ich, beim Schließen wird er geöffnet
- **Verlust-Buße**: bei Regelbruch automatische Spende (Commitment-Device nach stickK-Prinzip)
- **Plan-Vorlesen**: Plan laut vorlesen, Whisper prüft, ob Entry/Stop/Ziel korrekt genannt wurden
- **Dead-Man-Switch**: kein Wochenreview gemacht → kein neuer Trade
- **Marktphasen-Wetter**: Regime-Erkennung + „in diesem Regime bist du historisch bei −0,3R"
- **Disziplin-Tamagotchi**: ein Wesen, das von Plan-Treue lebt — gamifiziert die Disziplin, nie die Rendite
- **Das Jahrbuch**: dein Trading-Jahr als gesetztes PDF zum Ausdrucken

---

## Douglas-Filter für alles hier

Aus `CLAUDE.md`: Gebaut wird, was **Prozess und vordefiniertes Risiko** stärkt. Nicht gebaut wird,
was Prognose- und Meinungssucht füttert — Rating-Gauges, Social-Ideas-Feeds, Screener-Getriebe.
Zwei Punkte aus dem Backlog stehen bewusst an dieser Grenze und bekommen deshalb Leitplanken:
der **Freundes-Feed** (Trades erst nach Abschluss sichtbar) und das **Tamagotchi**
(gamifiziert Disziplin, niemals Rendite).
