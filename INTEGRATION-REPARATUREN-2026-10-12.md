# Gemeinsame lokale Integration der Reparatursessions

> Historischer Bericht auf Basis `a193227`, gesichert in `52ec4df`. Aktueller Abschluss: [Upstream-Integration](ABSCHLUSS-UPSTREAM-INTEGRATION-2026-10-12.md). Neun-Fragen-Gate, fehlende Git-Historie, Testzahlen und uncommitteter Stand unten gelten nicht für die neue Branch. Die Ursprungssicherung bleibt im bisherigen Worktree `3b2d` und in `52ec4df` erhalten.

Stand: 12.10.2026. **Lokal repariert und integriert, nicht veröffentlicht.**

Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/`.
Integrationsfläche: `C:/Users/sabin/.codex/worktrees/3b2d/stock-hit-rate-tracker`.
Branch: `codex/integration-tracker-reparaturen-2026-10-12`, Ausgangscommit `a193227`.
Der Hauptcheckout bleibt sauber auf `main`/`a193227`. Kein Commit, Push, Deployment oder Datenbankeingriff.

## Übernahme und Erhalt der Ursprünge

Session 2 wurde aus `C:/Users/sabin/.codex/worktrees/8146/stock-hit-rate-tracker` übernommen: sieben getrackte Änderungen und fünf gezielt ausgewählte neue Quell-/Testdateien. Beim Kopieren wurden alle zwölf Dateien per SHA-256 mit dem Ursprung verglichen. Keine direkte Dateiüberschneidung mit Session 1. Der Session-2-Worktree wurde weder geändert noch bereinigt; seine Dateiliste ist beim Abschluss weiterhin identisch.

Vor dem Zurückstellen von Session-1-Anteilen wurde deren kompletter uncommitteter Ursprung gesichert: [Ursprungssicherung](integration/ursprung-session1/README.md). Sie enthält den binären Git-Diff aller getrackten Änderungen und unveränderte Kopien aller vier damaligen ungetrackten Quell-/Test-/Berichtsdateien. Der bisherige Session-1-Bericht bleibt als historischer Abschluss erhalten; für den gemeinsamen Stand gilt dieser Bericht.

Keine `.env`, Abhängigkeiten, Runtime-, Vorschau- oder Skilldateien wurden aus Session 2 übernommen. Die schon vorhandene lokale `node_modules`-Junction wurde nur zur Testausführung verwendet. Der bestehende Trading-Assistent-Pfadfix wurde weder erneut geschrieben noch zurückgenommen. Es wurden keine Zugangsdaten aus Altpfaden übernommen.

## Regelgrenze: Demo behalten, Archiv und neue Zeitgrenze zurückgestellt

**Belegter bestehender Vertrag:** `lib/trade-kind.ts:60` definiert das Pre-Trade-Gate vor Aktivierung; `PROJEKT-KONTEXT.md:507` verlangt alle neun Ja-Antworten außer beim schnellen Trade. `app/actions/trades.ts:598` setzt dies beim manuellen Aktivieren um.

**Unmittelbarer Bezug zum Speicher-/Aktivierungsproblem:** `app/actions/trades.ts:2037` und `:2041` führen Aktivierung und Planspeicherung über `withManualTrade` aus. Dieses ruft in `lib/manual-trade.ts:16` zuerst den Demo-Abgleich auf und erst in `:27` die manuelle Aktion. Zuvor konnte ein langfristiger Plan ohne Freigabe bei Kursberührung bereits während dieses vorgeschalteten Abgleichs aktiviert werden; die anschließende manuelle Aktion traf dann einen anderen Status an. Dies ist ein aus dem lokalen Aufrufpfad belegter synthetischer Fehlerfall, kein Nachweis des unbekannten persönlichen Vorfalls vom 11.10.

**Übernommen:** Der normale Demo-Abgleich prüft in `lib/demo-run.ts:74` und nochmals unter der bestehenden Sperre in `:97` ausschließlich das bestehende `requiresPreTradeGate`/`preTradeAnswered`. Unfreigegebene langfristige Pläne bleiben geplant; freigegebene und schnelle Trades behalten ihren bisherigen Ausführungsweg. Aktive Positionen bleiben bearbeitbar. Testbeleg: `lib/demo-run.integration.test.ts:132` sowie die parametrisierten Gegenfälle ab `:203`.

**Zurückgestellt:** Der zusätzliche Guard in `repairDemoArchive` ist aus der gemeinsamen Lösung entfernt. Der Archivweg ab `lib/demo-run.ts:511` entspricht wieder dem Ausgangsstand; seine Erweiterung war für das gemeldete UI-/Speicherproblem nicht erforderlich belegt. Ebenfalls entfernt ist das erstmalige Setzen von `demoBoundaryAt` bei Douglas-Freigabe. Die Freigabe in `lib/release-trade-plan.ts:25` speichert nur Antworten und Freigabeflag, keine neue Rückwirkungsgrenze. Der Gegenfall ist in `lib/release-trade-plan.test.ts:37` festgehalten. Beide ursprünglichen Erweiterungen bleiben in der Ursprungssicherung erhalten. Bestehende Zeit-/Historienverarbeitung wurde nicht umdefiniert.

## Vorher-/Nachherfälle mit Quell- und Testbelegen

Alle unten genannten Beispiele sind synthetische Regressionen. Persönliche Fälle oder exakte Fehlertexte wurden nicht ergänzt.

| Fall | Vorher | Gemeinsamer Stand und Beleg |
| --- | --- | --- |
| Langfristiger API-Trade ohne Douglas-Antworten | Korrekt geplant und gesperrt, aber kein nachträglicher Freigabeweg in der UI. | Neun-Fragen-Dialog, separate Freigabe; Nein bleibt gesperrt. `components/trade-card.tsx:149`, `app/actions/trades.ts:504`, `lib/release-trade-plan.ts:9`; `lib/release-trade-plan.test.ts:27`. |
| Ungültige oder mehrfach identische Antworten | Nur Anzahl und Ja-Werte wurden geprüft. | Neun eindeutige bekannte Schlüssel und gültige Antworten; kanonische Fragen. `lib/pre-trade-questions.ts:24`; `lib/release-trade-plan.test.ts:58`. |
| Teilziele laden nicht | Fehler wurde als leere Liste behandelt; Speichern konnte bestehende Teilziele entfernen. | Sichtbare Fehlermeldung und gesperrtes Speichern bis zum erfolgreichen Laden. `components/edit-trade-dialog.tsx:81`, `:146`, `:326`. |
| Überholter Editor/Aktivierungsdialog | Alte Eingaben konnten ohne angezeigte Versionsbindung geschrieben werden. | Beim Öffnen festgehaltene Version und serverseitige Ablehnung veralteter Eingaben. `components/edit-trade-dialog.tsx:70`, `components/trade-card.tsx:124`, `app/actions/trades.ts:591`, `:725`; `lib/trade-lifecycle.test.ts`. |
| `BTC/EUR`, `BTCEUR`, `BTC-USDT` | Trennzeichen konnten doppelt werden; explizite Paarwährung konnte durch USD ersetzt werden. | Paar und Währung bleiben erhalten. `lib/market-data/resolve.ts:293`; `lib/market-data/resolve-path.test.ts:20`, `:27`, `:64`. |
| Explizites `LSE:EXM` gegenüber liquiderem `EXM.DE` | Heimatbörsenheuristik konnte eine andere Notierung bevorzugen. | Kandidaten bleiben an der expliziten Notierung. `lib/market-data/resolve.ts:246`, `:371`; `lib/market-data/resolve-path.test.ts:33`. |
| Verschiedene Firmennamen bei gleicher Tickerwurzel/Bilanzwährung | Konnten als dasselbe Instrument zusammengefasst werden. | Name muss die Identität stützen. `lib/market-data/resolve.ts:571`; `lib/market-data/resolve-path.test.ts:53`. |
| Ausgewählter Suchtreffer ohne Kursbestätigung | Automatische Ersatzauflösung konnte die Suchauswahl verlieren. | Auswahl atomar gespeichert, gepinnt und ungeprüft markiert; kein Ersatz durch Automatik. `app/actions/stocks.ts:287`, `:314`, `app/actions/symbols.ts:260`; `lib/market-data/search-save.test.ts:36`. |
| Yahoo-Kurs ohne belegte Zeit/mit ungültigem Preis | Fehlende Zeit konnte durch aktuelle Abrufzeit ersetzt werden. | Preis und belegte Zeit gehören zusammen; ungültige Werte werden verworfen. `lib/market-data/yahoo.ts:447`, `:546`, `:551`; `lib/market-data/yahoo-quote.test.ts:19`. |
| Binance für `BTC-USD` | Konnte USDT-Kerzen unter einer USD-Identität liefern. | USD bleibt USD; fehlendes Paar wird abgelehnt. `lib/market-data/binance.ts:22`; `lib/market-data/history.test.ts:47`. |
| Gerade abgerufener Vortageskurs in der Watchlist | Abrufalter erschien als Kursalter. | Alter aus `quotedAt`; fehlende/ungültige Zeit ausdrücklich unbekannt. `components/watchlist/watchlist-grid.tsx:303`, `:398`, `lib/market-data/quote-age.ts:2`; `lib/market-data/quote-age.test.ts:7`. |

## Gezielte Anpassung an der gemeinsamen Schnittstelle

Die Trade-Anlage verwendet bei fehlender exakter Tickergleichheit `findInstrumentFor`: `lib/create-trade-service.ts:425`, `lib/link-trades.ts:59`. `addStock` hängt bestehende unverknüpfte Trades ausschließlich über Eigentümer, exakten Ticker und `stockId IS NULL` an (`app/actions/stocks.ts:340`); bestehende Zuordnungen werden nicht überschrieben. Die neue Suchauswahloption ist optional, der freie Anlageweg und die Trade-Instrumentanlage behalten ihren bisherigen Aufrufvertrag.

Beim Zusammenführen wurde eine konkrete Lücke im Trade-Pfad sichtbar: `matchInstrument('LSE:EXM', null, [EXM.DE])` konnte vor der verbesserten Auflösung über die gemeinsame Tickerwurzel Xetra wählen. Bei zwei Notierungen konnte es stattdessen vorzeitig mehrdeutig zurückkehren. `lib/instrument-link.ts:132` verwendet den Grundticker-Rückfall nun nur für unqualifizierte Eingaben; exakte Ticker- und Anbieter-Symboltreffer gehen weiterhin vor. Der Gegenfall `EXM → EXM.DE` bleibt möglich.

Der neue Integrationstest deckte zusätzlich auf, dass der Resolver das bekannte Präfix für den exakten Identitätsvergleich noch zu `EXM` statt `EXM.L` übersetzte. `lib/market-data/resolve.ts:487` verwendet jetzt dieselbe belegte Präfix-/Suffixübersetzung wie die Kandidatenbildung. Keine Absenkung einer Vertrauensschwelle. `lib/trade-instrument-integration.test.ts:35` prüft fremden Handelsplatz, korrekte London-Zuordnung und den unqualifizierten Gegenfall. Ab `:44` wird der vollständige Anlageweg bis zur gespeicherten `stockId=7`, Status geplant und weiterhin gesperrtem Douglas-Gate geprüft. DB und Anbieterantworten sind isoliert simuliert.

## Tatsächliche gemeinsame Checks

- Einmaliger Gesamtlauf: `node node_modules/vitest/vitest.mjs run` — **67 Testdateien, 1.171 Tests: 1.168 bestanden, drei Fehler** im neuen Integrationstest. Keine anderen Testfehler.
- Nach der gezielten Präfixkorrektur ausschließlich betroffene Dateien wiederholt: `lib/trade-instrument-integration.test.ts`, `lib/instrument-link.test.ts`, `lib/market-data/resolve-path.test.ts`, `lib/market-data/resolve.test.ts` — **4 Dateien, 59 Tests bestanden**, einschließlich aller drei zuvor fehlgeschlagenen Fälle. Damit sind alle 1.171 erfassten Tests durch grünen Gesamtlaufanteil beziehungsweise gezielten Nachlauf abgedeckt; kein zweiter vollständiger Lauf wurde behauptet oder ausgeführt.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: nach Integration grün, nach der konkret erforderlichen Korrektur nochmals grün.
- `git diff --check`: nach Integration und gezielter Korrektur grün.
- Keine produktiven Trades, Provider-Netzwerkaufrufe oder Datenbank-Schreibtests. Keine zusätzlichen allgemeinen Prüfzyklen.

## Integrierte Dateien

Session 1: `app/actions/trades.ts`, `components/edit-trade-dialog.tsx`, `components/trade-card.tsx`, `lib/create-trade-service.ts`, `lib/pre-trade-questions.ts`, `lib/release-trade-plan.ts`, `lib/release-trade-plan.test.ts`, `lib/trade-lifecycle.test.ts`, `lib/demo-run.ts`, `lib/demo-run.integration.test.ts`.

Session 2: `app/actions/stocks.ts`, `app/actions/symbols.ts`, `components/watchlist/watchlist-grid.tsx`, `lib/market-data/binance.ts`, `lib/market-data/history.test.ts`, `lib/market-data/resolve.ts`, `lib/market-data/yahoo.ts`, `lib/market-data/quote-age.ts`, `lib/market-data/quote-age.test.ts`, `lib/market-data/resolve-path.test.ts`, `lib/market-data/search-save.test.ts`, `lib/market-data/yahoo-quote.test.ts`.

Gemeinsame Schnittstellenkorrektur: `lib/instrument-link.ts`, `lib/trade-instrument-integration.test.ts` sowie der oben beschriebene kleine Zusatz in `lib/market-data/resolve.ts`. Dazu dieser Bericht, historischer Session-1-Bericht und Ursprungssicherung. Alles liegt als reviewbarer uncommitteter Branch-/Worktree-Stand vor.

## Offene Grenzen und Browsernachweis

- Exakte persönliche Nutzerfälle und Fehlertexte vom 11.10. fehlen. Die belegten Codefehler erklären mögliche Abläufe, nicht rückwirkend diesen Vorfall oder seine abendliche Erholung.
- Bestehende falsche Instrumentzuordnungen, Kurs-Snapshots oder gespeicherte Kerzen wurden nicht bereinigt. Neue Ablehnungen reparieren keine bereits gespeicherten Daten.
- Produktiver GET-Nachweis bleibt offen: Im bestätigten Haupt-Repository fehlten bei Session 1 `ASSISTANT_API_BASE_URL` und `ASSISTANT_API_TOKEN`. In dieser Integration keine neue Zugangsdatenprüfung und keine Übernahme aus Altpfaden.
- Der dokumentierte neuere Produktionscommit `94a45e7` fehlt in der vorhandenen Git-Historie. Der saubere lokale Hauptstand `a193227` ist deshalb kein Nachweis des aktuellen produktiven Vertrags. Keine stillschweigende Übernahme dokumentierter, hier nicht vorhandener Produktionsfunktionen.
- Session 1: tatsächliche lokale Edge-Prüfung mit synthetischer Vorschau bestätigte Fragen-Dialog, Nein-Hinweis und gesperrtes Speichern nach Teilziel-Ladefehler. Vollständiger Fragen-Durchlauf scheiterte am Browser-Werkzeugzeitlimit; Server-Erfolgsfälle sind getestet.
- Session 2: laut Abschlusskoordination wurde die Browsersichtprüfung automatisch wegen privater Tabinventur abgelehnt. Diese Ablehnung ist keine erfolgreiche Sichtprüfung. Es gab hier keinen neuen Inventurversuch und keine neue kombinierte Browserabnahme. Insbesondere Watchlist-Kursalter ist durch Code-/Testbelege, noch nicht durch eine bestätigte Browsersichtprüfung abgenommen.
- Keine Skillordneränderungen. Sicheres späteres Committen/Veröffentlichen und produktive Abnahme sind getrennte Schritte und wurden nicht ausgeführt.
