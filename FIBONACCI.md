## Nachtrag 11.10.2026: 2h und mobile Tabellen

`2h` wird als Zeiteinheit für Beobachtungen, Filter und historische CSV-Datensätze unterstützt. Migration 0051 erweitert ausschließlich die Zeiteinheitsprüfung; bestehende Werte bleiben erhalten. Bei historischen Kursen ist ein 2h-Abstand 7.200 Sekunden. Die zugängliche Bearbeiten-Spaltenüberschrift bleibt im relativ positionierten Scrollcontainer; gefüllte Tabellen dürfen keine globale Seitenüberbreite erzeugen.

# Erweiterter Forschungsvertrag vom 11.10.2026

Dieser Nachtrag beschreibt den lokal geprüften Ausbau; keine produktive Verfügbarkeit. Migrationen 0048–0050 additiv vor Veröffentlichung anwenden, ausschließlich nach separatem Produktivauftrag. Vorhandene IDs/Anker/Versionen bleiben erhalten; 0049 legt bestehende Revisionen an, weitere Änderungen protokolliert ein Trigger.

## Beobachtungen und Zuordnung

Wellenlabels 1–5/A/B/C/X/Y und eigene nichtleere Labels bis 40 Zeichen. `degree` und `timeframe` dürfen `unbekannt` sein; UI bietet beide Filter einschließlich alle/unbekannt. Status: laufend, abgeschlossen, unklar, ungueltig. Fehlender Prozentwert bleibt null. Retracement 0–500 %, direkt oder aus den bisherigen drei Ankern; Expansion als direkter endlicher nichtnegativer Prozentwert mit `measurementBasis`, keine Ankerformel.

Optionale Felder: sourceKey/sourceRef, periodFrom/periodTo, structure, target, stopDescription, tradability, hypotheticalOutcome/actualOutcome, tradeId, historyId, stopVariants. Trade und Kursdatensatz müssen demselben Besitzer und Instrument gehören. `contextId` ist stabil und kennzeichnet die konkrete Welle. Eindeutig vollständig übereinstimmende Instrument-/Label-/Grad-/Timeframe-/Zeitraumangaben können einen bestehenden Kontext zuordnen; Mehrdeutigkeit ergibt 409. Ohne eindeutigen Bezug keine Zuordnung aus alten Trades erraten. Pro Besitzer/Kontext/Messart und Besitzer/sourceKey/Messart gilt Wiederholungsschutz. Inhaltliche Korrekturen erfolgen per PATCH mit aktueller Version, nicht durch neue IDs.

## API

Alle Pfade unter `/api/assistant/v1`, bestehende Tokenrechte `trades:read`/`trades:write`:

- GET/POST `/fibonacci`, GET/PATCH `/fibonacci/{uuid}`; POST Idempotency-Key, PATCH X-Expected-Version. GET nach jedem Schreiben, zurückgegebene ID verwenden: Inhaltswiederholung kann die bereits vorhandene ID liefern.
- GET `/fibonacci/context`: Instrument über genaue `instrument`-Bezeichnung/Ticker oder stockId eingrenzen; bestehende Wellenfilter. Antwort instruments/contexts/candidates/total/nextOffset/resolution (`eindeutig`, `mehrdeutig`, `instrument_unklar`, `neuer_fall`).
- GET `/fibonacci/{uuid}/revisions`: items mit Version, Snapshot ohne userId und recordedAt.
- GET/POST `/fibonacci/history`, GET `/fibonacci/history/{uuid}`. Liste stockId optional, aktuell höchstens 100 neueste Datensätze. POST CSV-normalisierte candles oder origin=cache mit from/to in Unix-Sekunden; immer Idempotency-Key. Imports unveränderlich, version=1; Korrektur als neuer Datensatz, danach Beobachtungsbezug versioniert ändern.
- GET `/instruments`: items mit denselben kontoweiten Kartenwerten, separaten research-Kennzahlen, fibonacci-Fallzahlen und quote, basis nennt Gesamtwerte über alle Depots.

Fibonacci-GET liefert items, total, nextOffset, stats, statsByKind, metrics und basis. Filter/Statistik gelten für die vollständige Auswahl vor Pagination. Messarten getrennt; abgeschlossene gültige Wellen je Beobachtungs-ID einmal, neueste Revision. `metrics` zählt eindeutig verknüpfte abgeschlossene Trades einmal, dieselbe Berechnung wie UI. Kartenwerte bleiben kontoweit, auch bei Seiten-/Depotfiltern.

## Kurse und Kennzahlen

Vorhandener Kerzenspeicher nur lesend; keine Anbieterabfrage. CSV per Datei oder Einfügen mit Spaltenzuordnung/Vorschau; maximal 8.000.000 Zeichen und 20.000 Kerzen (Datei zusätzlich 8 MB). Quelle, Instrument, Intervall, Zeitzone und Währung erforderlich. UTC normalisieren, OHLC/Volumen prüfen, identische Zeitduplikate zusammenfassen, widersprüchliche ablehnen. DST-Mehrdeutigkeiten benötigen expliziten Offset. Datenlücken als größere Zeitabstände anzeigen, keine fehlenden Börsensitzungen erfinden. Import überschreibt weder gemeinsamen Kerzenspeicher noch frühere Datensätze; identischer normalisierter Inhalt inklusive Metadaten wird wiederverwendet.

Gewinnquote = positive Nettoergebnisse / abgeschlossene Trades mit berechenbarem Nettoergebnis; Break-even/Verlust im Nenner. Geplantes CRV und realisiertes R verwenden belegte ursprüngliche Plan-Snapshots, keine späteren Stops. Fehlende Grundlage null / nicht berechenbar, jeweils eigene Fallzahl. Echtgeld/Demo und Währungen getrennt; dokumentierte hypothetische Stopvarianten sind keine abgerechneten Trades und werden separat ausgewertet.

## Lokale Abnahme

`node node_modules/vitest/vitest.mjs run`, unabhängiges `tsc --noEmit --incremental false`, `next build --webpack`. Lokale flüchtige QA: `node --experimental-strip-types scripts/fibonacci-local-preview.mjs --production`, danach `node scripts/verify-fibonacci-local.mjs`. Kein .env-Import durch den Preview-Runner; Datenbank und Auth-Ziel ausdrücklich Loopback. Vorschau nach Abschluss stoppen; keine synthetischen Daten im echten Konto.

---

# Fibonacci-Beobachtungen und Auswertung

Stand: 08.10.2026. Lokale Erweiterung im führenden Tracker-Repository; produktive Migration und Veröffentlichung sind separat freizugeben.

## Bedienung

Auf **Auswertung → Fibonacci** liegt die instrumentübergreifende Fibonacci-Auswertung direkt als erster Abschnitt mit Sprungmarke. Sie bleibt zusätzlich auf **Analyse** erreichbar. Die Messungen gelten über Depotgrenzen hinweg; der Depotumschalter filtert sie nicht. Auf jeder **Instrumentseite** erscheint dieselbe Auswertung auf dieses Instrument begrenzt. „Beobachtung“ öffnet das Formular. Ein Trade ist keine Voraussetzung.

1. Instrument, Welle, Wellengrad, Zeiteinheit und Beobachtungsdatum wählen.
2. Tatsächlich gemessene Tiefe direkt in Prozent eingeben oder Anfang/Ende der Referenzbewegung und das folgende Korrekturextrem eintragen. Preise müssen dieselbe Währung, Bereinigung und Kursskala verwenden. Dezimalwerte über das Zahlenfeld eingeben.
3. Messnotiz/Quelle mit konkretem Zeitraum, Referenzpunkten und Abschlusskriterium ergänzen. Eine Welle je Wellengrad und Zeitraum einmal erfassen. Erreicht die laufende Welle ein neues Extrem, dieselbe Messung bearbeiten.
4. „Laufend“ ist vorbelegt. Erst eine tatsächlich abgeschlossene Welle auf „Abgeschlossen“ setzen; dies ist eine eigene bestätigte Einordnung. Es gibt keine automatische Elliott-Erkennung. „Ungültig“ nimmt den Fall aus der Statistik und erhält ihn im Protokoll.
5. „Speichern“ schreibt und liest den gespeicherten Datensatz serverseitig zurück. Die Stift-Schaltfläche lädt die aktuelle Messung in den Editor. Bei einem Versionskonflikt den aktuellen Stand neu laden, bevor die Korrektur wiederholt wird.

Filter: Instrument, Anlageklasse, Welle, Wellengrad, Zeiteinheit und inklusiver Zeitraum. „Übergeordnet“ umfasst die Gesamtstichprobe über Instrumente sowie die Auswahl höherer Wellengrade. Aktien und Krypto sind separat filterbar. Der CSV-Export enthält alle zur Auswahl passenden Beobachtungen einschließlich Status und exakter Werte, nicht nur die sichtbare Protokollseite. UTF-8 mit BOM, Semikolon, korrekt maskierte Texte und Formelpräfixschutz; Zahlen verwenden einen Dezimalpunkt. Keine Positions- oder Geldbuchung wird verändert.

## T3: historische Zeit und Wellenhierarchie

`evidence.historicalTime = {start, end, source?}` ist optional. Jede Grenze ist `null` (unbekannt) oder `{precision: "day"|"month"|"year", date, approximate?, earliest?, latest?}`. `date` verwendet `JJJJ-MM-TT`, `JJJJ-MM` oder `JJJJ`. Belegte Unsicherheitsgrenzen sind volle ISO-Tage; sie sind nur bei `approximate:true` erlaubt und müssen die nominale Kalenderangabe umschließen. Ungefähre Angaben ohne solche Grenzen erhalten keine erfundene Toleranz. Alte `periodFrom`/`periodTo` bleiben genaue historische Tagesgrenzen, wenn keine strukturierte Zeit vorhanden ist. Widersprechende Angaben werden abgelehnt. `observedOn` bleibt das dokumentierte Erfassungsdatum, unabhängig von `createdAt`.

GET `/fibonacci` und `/fibonacci/context`: `from`/`to` erlauben Tag/Monat/Jahr und wählen standardmäßig historische **Intervallüberlappung**, einschließlich der Suchgrenzen. `timeBasis=recorded` wählt ausdrücklich `observedOn`. `timeMatch=certain|possible|unknown|all` (Standard `certain`) wählt sichere, mögliche oder unbekannte Fälle; `all` umfasst alle außer nachweislich ausgeschlossenen Fällen. `timeSelection` enthält `basis`, `selected`, `denominator` und die disjunkten ID-Gruppen `certain`, `possible`, `unknown`, `excluded` **vor Pagination**. Ohne Zeitgrenzen bleibt die Population ungefiltert; daraus folgt keine Datumsgenauigkeit. Ungültige Suchgrenzen ergeben HTTP 400.

`evidence.parentId` verweist auf eine eigene Beobachtung desselben Instruments. Fehlende/fremde Eltern, Selbstbezug, Zyklen und unvereinbare Instrumentwechsel werden abgelehnt; die additive Migration `0058_fibonacci_hierarchy.sql` sichert konkurrierende Hierarchieänderungen in der DB. `observationId=<UUID>&waveScope=self|descendants` wählt eine Welle allein oder samt Nachkommen; ohne Ausgangswelle ist `waveScope` ungültig. Andere ausdrücklich gesetzte Filter bleiben Schnittmengen. `hierarchyRole=main|subwaves` filtert nach fehlendem/vorhandenem Elternbezug. Das ist keine fachliche Bestätigung eines Hauptcounts.

GET `/fibonacci` liefert außerdem `hierarchyGroups` mit Rolle, IDs, Fallzahl und eigenen `statsByKind`. Kinder behalten eigene IDs; Revisionen ersetzen nur dieselbe Beobachtungs-ID. Liste, Statistik und CSV verwenden dieselbe Auswahl. CSV erhält strukturierte Zeit und Elternbezug im bestehenden JSON-Inhalt. Ältere Schreibclients erhalten ausgelassene neue Angaben; ausdrückliches Löschen erfolgt je Schlüssel mit `null`. Details und Abnahmematrix: [T3-Bericht](docs/tracker-t3-2026-10-18.md).

## Messdefinition und Statistik

`Tiefe = (Referenzende − Korrekturextrem) / (Referenzende − Referenzanfang) × 100`

Beispiele zur Definition (synthetisch): 100 → 200, Extrem 138,2 ergibt 61,8 %. 200 → 100, Extrem 161,8 ergibt ebenfalls 61,8 %. 100 → 200, Extrem 50 ergibt 150 %. Gleiche Anker, nicht endliche/nicht positive Preise und Tiefen außerhalb 0–500 % werden abgelehnt. Keine Ableitung aus Trade-Zielen, alten Notizen oder Chartzeichnungen.

Nur **abgeschlossene** gültige Messwerte bilden den Nenner. Laufende und ungültige Fälle haben eigene Anzahlen. Mittelwert wird aus den ungerundeten Tiefen berechnet; Median und Quartile interpolieren linear zwischen benachbarten sortierten Werten: Position `(n−1)×q`. UI rundet nur die Anzeige auf eine Nachkommastelle; Speicherung und CSV behalten die Genauigkeit.

**Endzonen-Verteilung:** Referenzmarken 0 / 23,6 / 38,2 / 50 / 61,8 / 78,6 / 100 / 127,2 / 161,8 / 200 / 261,8 / 423,6 %. Grenzen liegen jeweils in der Mitte zwischen benachbarten Marken; ein exakter Grenzwert gehört zur höheren Zone. Die erste Zone beginnt bei 0 %, die letzte reicht bis einschließlich 500 %. Jede Welle zählt einmal. Die häufigste Zone kann einen Gleichstand haben. 50 % ist eine gebräuchliche Referenzmarke; der Modus einer Zone ist kein exakter Kurswendepunkt.

**Erreichte Schwellen:** Anteil mit Tiefe mindestens gleich der Referenzmarke. Eine Welle mit 100 % erreicht auch die darunterliegenden Schwellen. Die Anteile summieren sich deshalb nicht zu 100 %. Die Darstellung bestätigt eine gemessene Tiefe, keine punktgenaue Intraday-Kursberührung.

**Welle × Endzone:** Anzahl je Welle und Endzone; Farbintensität relativ zum häufigsten Feld dieser Zeile. **Instrumentvergleich:** Mittelwert, Median, häufigste Zone und Anzahl; nach Fallzahl sortiert. Unter zehn Fällen markiert die Oberfläche Ergebnisse explorativ. Zehn ist eine Anzeigegrenze, kein Signifikanztest. Selektive Erfassung und abhängige/verschachtelte Wellen können auch größere Stichproben verzerren. Keine Aussage über Gewinnquote, zukünftige Kurswahrscheinlichkeit oder repräsentative Marktstatistik.

## Assistenten-API

Basis `/api/assistant/v1`. Bearer-Token mit bestehenden Rechten `trades:read` bzw. `trades:write`. Keine neuen Tokenrechte. Nur eigene Instrumente und Beobachtungen sind erreichbar. UUIDs, Feldnamen, Enumerationen, Datum und Messwerte werden streng geprüft.

| Methode / Pfad | Vertrag |
| --- | --- |
| `GET /fibonacci` | Filter `stockId`, `market`, `wave`, `degree`, `timeframe`, `from`, `to`; `limit` 1–500 (Standard 100), `offset` ab 0. Antwort `items`, `total`, `nextOffset`, `stats`. Statistik umfasst **alle** passenden Fälle, unabhängig von der Listenseite. |
| `GET /fibonacci/{uuid}` | Gespeicherter Datensatz mit Version und Zeitstempeln; fremde/unbekannte ID → 404. |
| `POST /fibonacci` | Vollständige Messung, JSON und `Idempotency-Key` als UUID. Schlüssel ist die Datensatz-ID. Wiederholung desselben Inhalts liefert denselben Datensatz; anderer Inhalt mit demselben Schlüssel → 409. Antwort 201. |
| `PATCH /fibonacci/{uuid}` | Vollständiger Ersatz der Messfelder und `X-Expected-Version`. Update atomar, Version steigt um 1. Stale Version → 409; Inhalt/Instrument müssen erneut gültig sein. |

Messfelder: `stockId` (positive Integer), `wave` (`2`, `4`, `A`, `B`, `C`, `X`, `Y`), `degree` (`GrandSupercycle`, `Supercycle`, `Zyklus`, `Primär`, `Intermediär`, `Minor`, `Minute`, `Minuette`, `Subminuette`), `timeframe` (`5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`, `1M`), `observedOn` (`YYYY-MM-DD`, kein zukünftiges Datum), `status` (`laufend`, `abgeschlossen`, `ungueltig`), `note` (nicht leer, maximal 2000 Zeichen).

Direktmessung: `percent` als Zahl 0–500; `anchorStart`, `anchorEnd`, `extreme` jeweils `null`. Ankermessung: alle drei positiven Preise; `percent: null` berechnet serverseitig. Eine zusätzlich mitgesandte Prozentzahl darf höchstens 0,01 Prozentpunkte vom Ankerergebnis abweichen. Gespeichert wird immer das berechnete Ergebnis. Keine unbekannten Felder. Fehler: 400 Syntax/Filter/Header, 401 Authentifizierung, 403 Rechte, 404 Besitz/ID, 409 Konflikt, 422 Messvalidierung, 503 unerwarteter Dienstfehler.

Pagination ist offsetbasiert, nach Datum/Erstellung/ID absteigend. Für konsistente Exporte während des Lesens keine parallelen Erfassungen vornehmen; es gibt keinen Snapshot-Cursor. `stats.zones` enthält Grenzen, exklusive `count` und kumulative `reached`; `stats.modes` enthält alle häufigsten Zonen. `mean`, `median`, `q1`, `q3` sind ohne abgeschlossene Fälle `null`. GET nach jedem Schreiben verwenden.

Der lokale Client im Trading-Assistenten erlaubt `/fibonacci` und `/{uuid}`, POST nur mit `--key`, PATCH nur mit `--version`. Nach Veröffentlichung zum Beispiel `node scripts/tracker-api.mjs GET '/fibonacci?wave=B&market=aktien&degree=Minor'`. Kein API-Token gehört in Dokumentation oder Ausgaben.

## Speicherung, Migration und Veröffentlichung

Neue Tabelle `fibonacci_observation`; FK auf Nutzer/Instrument mit Cascade beim Löschen, Besitzer/Instrument/Datum-Index. Checks für Messwerte, Ankerkonsistenz, Status, Welle, Grad und Zeitrahmen. Versionen werden durch den gemeinsamen Service erhöht; keine Geldtabellen werden geschrieben. Wiederholungsanlage verhindert technische Duplikate, erkennt aber nicht automatisch die erneute manuelle Eingabe derselben realen Welle mit neuer UUID.

Migration: `drizzle/0048_fibonacci_observations.sql`. `scripts/apply-fibonacci-migration.mjs` ist standardmäßig Dry-run. Für einen bewusst ausgewählten direkten PostgreSQL-Zugang: `FIBONACCI_MIGRATION_DATABASE_URL` setzen und `node scripts/apply-fibonacci-migration.mjs --apply`. Zugangsdaten nie ausgeben. Das Skript nutzt eine Transaktion, kurze Lock-/Statement-Timeouts und vergleicht Instrument-, Trade- und Depot-Fingerprints vor/nach der Migration. Zweiter Lauf ist idempotent. Anschließend Migration vor dem neuen App-Build veröffentlichen, GET-/POST-/PATCH- und UI-Abnahme separat durchführen. Keine automatische Veröffentlichung in dieser Sitzung.

Bei Rücknahme zuerst App-Code zurücksetzen; neue Tabelle und Beobachtungen erhalten. Kein automatisches DROP und kein Zurückschreiben einer älteren Projektkopie. Bereits gespeicherte Beobachtungen gehören zum führenden Repository-/Datenbankvertrag.

## Reproduzierbare lokale Abnahme

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `node node_modules/vitest/vitest.mjs run lib/fibonacci.test.ts lib/fibonacci-db.test.ts`
- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/next/dist/bin/next build --webpack`

Browser-Testumgebung ohne Cloud-Daten: `npm install --prefix .test-tools --no-save --package-lock=false @electric-sql/pglite-socket@0.2.11 @electric-sql/pglite@0.5.8`, danach `node --experimental-strip-types scripts/fibonacci-local-preview.mjs`. Sie erstellt eine frische lokale Datenbank und synthetische Nutzer-/Messfälle auf Loopback. `--empty` startet ohne Instrument- und Messfixtures als vollständig leeres Prüfkonto. Nach dem Build startet `--production` den lokalen Produktionsserver statt der Dev-Laufzeit. `node scripts/verify-fibonacci-local.mjs` prüft die echte lokale HTTP-API einschließlich des Tracker-CLI-Clients und räumt ausschließlich seine synthetischen Datensätze auf. Testadresse und ausschließlich lokale Test-Zugangsdaten stehen in der Runner-Ausgabe. Beenden verwirft die In-Memory-Datenbank. Produktions-Umgebungsdateien werden nicht durch den Runner gelesen oder geändert; die Next.js-Umgebung erhält explizite lokale Datenbank-/Auth-Werte. Die Socketprüfung folgt der [offiziellen PGlite-Dokumentation](https://pglite.dev/docs/pglite-socket); sie ersetzt keine spätere produktive Neon-Abnahme.

## Arbeitsblock A vom 18.10.2026: getrennte Datenbasis (lokal)

Additive Leseerweiterung ohne neue Tabellen oder Schreibrechte. Lokale Umsetzung ist keine Veröffentlichung.

- `tradeSummaryByKind` und `tradeResearchCoverageByKind`: Schlüssel `money` (Echtgeld) und `demo`. Handelsart stammt ausschließlich aus dem eigenen verknüpften Depot. Fremde Trades, fremde/fehlende Depots und unbekannte Depotarten gehen nicht in diesen Bestand ein. Status bleibt geplant/aktiv/abgeschlossen. `tradeKindDiagnostics.mismatches` benennt Abweichungen zum gespeicherten `tradedWithMoney`; keine automatische Datenkorrektur.
- `tradeSummary` und `tradeResearchCoverage` bleiben kompatible **gemischte Gesamtansichten** des geprüften eigenen Tradebestands. Neue Bereichsansichten verwenden die getrennten Gruppen. Instrumentfilter gilt, Wellen-/Arbeitsauswahlfilter gilt nicht für den allgemeinen Handelsbestand. Prognosen bleiben im eigenständigen `assessment`-Bereich.
- `simulationSummary`: vorhandene hypothetische Angaben ausgewählter Beobachtungen; eigenes CRV, Ausgang, Exit, CRV-Bezug und hypothetische Stopvarianten. Jede Kennzahl nennt `n`, `denominator`, `included` (ID/Wert) und `excluded` (ID/Grund). Dokumentierte CRV-/Exitplanangaben sind bei laufenden und abgeschlossenen Beobachtungen verwendbar; hypothetische Ergebnis- und Ergebnisvarianten-Auswertung bleibt auf abgeschlossene Beobachtungen begrenzt. Die Bezugsmenge umfasst auch Fälle ohne hypothetische Angabe, damit Ausschlüsse sichtbar bleiben. Keine Tradeanlage, Datenkopie, rückdatierte Prognose oder tatsächliche Gewinnbuchung.
- `runningStatsByKind.retracement/expansion`: `provisional: true`, `ids`, `total`, eigene `coverage` für Struktur, Wellenrichtung, historische Zeit, berichtete Dauern/Verweildauer, bekannte Zonen, erreichte/verfehlte Levels und dokumentierten Messbezug. Keine endgültige Maximum-/Endlevelverteilung oder Abschlussquote. Unsichere Messbezüge bleiben gesondert unzugeordnet. Unbekanntes Touch-and-Go zählt nicht als Nein; eine Dauerobergrenze wird nicht als Punktwert gemittelt.
- `linkedTradeSummaryByKind`/`linkedTradeResearchCoverageByKind`: eigene Trades, die aus der ausgewählten Beobachtungsmenge zulässig verknüpft sind. `linkedTradeBasis` benennt Beobachtungs-/Trade-IDs und verworfene Verknüpfungen. Instrument und geprüfte Depotart müssen übereinstimmen. `linkedTradeBasis.samples` erklärt fehlende oder widersprüchliche Geldsamples. Trade-Status entscheidet über Trade-Kennzahlen, unabhängig vom Wellenstatus; Netto bleibt auf abgeschlossene Trades begrenzt. Jede Trade-ID zählt einmal.
- `metrics` bleibt die verknüpfte Netto-/R-Auswertung, `allTradeMetrics` der allgemeine eigene Handelsbestand. Plan-CRV aus Eröffnungssnapshot, aktuelles gespeichertes Plan-CRV, hypothetisches CRV, realisiertes R und qualitativer Ausgang bleiben getrennt. Geldsummen werden ausschließlich je bekannter Kontowährung ausgewiesen. Realisiertes R benötigt ursprüngliches Risiko samt gültigem eingefrorenem Währungsbezug, aber kein Kursziel. Fehlende Währung sperrt Nettoquote/R; IDs, Bezugsmenge und Ausschlussgründe sind additiv verfügbar.

Beobachtungen werden anhand **stabiler Beobachtungs-ID** gezählt; die höchste Version ersetzt nur dieselbe ID, bereits vor Filterung. Verschiedene IDs werden beim Lesen nicht wegen gleicher `contextId` zusammengelegt. Bestehende Schreibvalidierung und Wiederholungsschutz bleiben erhalten (darunter der bisherige eindeutige Kontext-/Messartindex); dieser Block erweitert nicht den Schreibvertrag für mehrere gleichartige Beobachtungen im selben Kontext. Historische Revisionssnapshots werden nicht zusätzlich geladen. API, interne Fibonacci-Daten und UI verwenden `fibonacciReadModel`; Instrumentkarten verwenden dieselbe Depotprüfung. Statistiken verwenden die gesamte Auswahl vor Listenpagination.

UI: bestehende Tabellen/Karten bleiben bestehen; „Laufend & Simulation“ enthält die neuen beschreibenden Gruppen. „Tradebezug“ und die allgemeine Trade-Auswertung zeigen Demo/Echtgeld getrennt. Abschlussabdeckung ist ausdrücklich als solche bezeichnet. Verweildauervertrag und Legacy-Löschschutz bleiben erhalten.

Lokale Prüfung: `node node_modules/vitest/vitest.mjs run --maxWorkers=2`, separate `tsc --noEmit`, `next build --webpack`. Synthetische Browserumgebung: `node --experimental-strip-types scripts/fibonacci-local-preview.mjs --block-a` (erfordert vorhandene lokale PGlite-/Socket-Testwerkzeuge, keine .env). Dieser Modus nutzt ausschließlich flüchtige Daten auf localhost:3018/5548. Finale konkrete Nachweise stehen in `docs/tracker-block-a-2026-10-18.md`.

## T6/T7 – gemeinsamer Suchvertrag (19.10.2026, lokaler Ausbau)

`researchResult` verwendet eine vollständige eigene Beobachtungspopulation für Suchinterpretation, Auswahl, Kennzahlen, getrennte Leveltreffer und Zeitgruppen. Erst danach werden Reihenfolge und Listenseite bestimmt. API, interne Ladefunktion und funktionale Oberfläche verwenden dieselben Auswahlfunktionen. Keine zusätzliche KI, Datenmigration oder neue Tokenberechtigung.

Additive Parameter für `GET /fibonacci`:

- `query`: strukturierte Begriffssuche (maximal 2000 Zeichen); vorhandene Filter werden als bestehende Kriterien geschnitten.
- `resolutions`: JSON-Objekt mit Entscheidungen wie `{"instrument:0":"1","waveLabelScope":"self","levelMeaning":"end"}`. IDs werden ausschließlich gegen den eigenen Instrumentkatalog geprüft; ungültige Entscheidungen lösen keine Mehrdeutigkeit auf.
- `waveLabelScope=self|descendants`, `levelFrom`, optional `levelTo` aus dem festen Katalog, `levelMeaning=end|reversal|target|passed`. ID-bezogener `waveScope` bleibt ein eigenständiger Hierarchiefilter.
- `order=newest|oldest|deepest` (Standard `newest`): Datum mit stabiler ID als Gleichstandsauflösung, beziehungsweise Messwert mit fehlenden Werten zuletzt. Kennzahlen bleiben unabhängig von der Reihenfolge.
- `format=csv`: sämtliche ausgewählten Fälle in derselben Sortierung, unabhängig von `limit`/`offset`; vollständige Evidence-JSON, Quellen, Zeitgenauigkeit, IDs und additive Versionsspalte bleiben erhalten. Ein HTTP-Leseaufruf verwendet eine Population; kein Snapshot über mehrere getrennte HTTP-Aufrufe garantiert.

Antwort additiv: `ready`, `error`, `interpretation`, `levelSelection`, erweitertes `basis`. Bei ungelöster/ungültiger Begriffssuche: `ready:false`, `items:[]`, `total:null`, `stats:null`, keine endgültigen gefilterten ByKind-Kennzahlen; offene Entscheidungen, unbekannte Teile und Konflikte bleiben sichtbar. Die separat beschrifteten allgemeinen Handelsdaten sind weiterhin unabhängig vom Wellenfilter. CSV in diesem Zustand: HTTP 422. Ungültige direkte Filter, doppelte Parameter, ungültige Sortierung/Seite/JSON: HTTP 400. Bestehende gültige Leseaufrufe und Schreibwege bleiben verwendbar.

`getFibonacciData(stockId?, queryString?)` akzeptiert optional denselben Suchvertrag; bestehende Aufrufe ohne zweiten Parameter bleiben erhalten. Eine feste Instrumentseite kann nicht durch einen widersprüchlichen Queryfilter verlassen werden.

Die bestehende Oberfläche persistiert die Auswahl unter `fib.*`: Filter, Textsuche, noch nicht übernommene Begriffssuche und Entscheidungen, Sortierung, Tab und 20er-Listenseite. Fremde Seitenparameter und Fragment bleiben erhalten. Unvollständige manuelle Levelauswahl bleibt im URL-Zustand sichtbar, sperrt jedoch das Ergebnis. Ungültige Suchadressen zeigen einen Fehler und benötigen ausdrückliches Zurücksetzen; kein stiller Rückfall auf die Gesamtstatistik. `fib.detail=<uuid>` öffnet eigene verfügbare Falldetails im bestehenden Dialogmuster. Beim Schließen beziehungsweise Browser-Zurück bleiben Auswahl, Seite, Scrollposition und Fokus erhalten. Ein fremder/unbekannter Verweis zeigt keine Daten. Das ist eine funktionale Ergänzung, kein Designumbau.

T7 erhält beide Dauerverträge: Klassen bleiben Klassen, historische exakte Werte behalten Genauigkeit und Zonen-Snapshot. Nur ausdrücklich gleiche Zeitbasis, Messweise und Zone erlauben die Konsistenzprüfung zwischen exakter Altangabe und Klasse; ein Handelstag erhält keine angenommene Stundenzahl. Neue widersprüchliche Paare werden mit 422 abgelehnt. Bereits gespeicherte Widersprüche bleiben lesbar und unverändert korrigierbar, tragen aber mit sichtbarem Ausschlussgrund zu keinem betroffenen Dauermittel/-klassenwert bei. Andere verwertbare Kennzahlen bleiben erhalten. Keine Nachpflege aus Notizen, keine Klassenmitten als Mittelwerte.

Lokale Nachweise und Rücknahme: `docs/tracker-t67-2026-10-19.md`. Veröffentlichung und produktive Abnahme bleiben getrennt.
