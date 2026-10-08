# Fibonacci-Beobachtungen und Auswertung

Stand: 08.10.2026. Lokale Erweiterung im führenden Tracker-Repository; produktive Migration und Veröffentlichung sind separat freizugeben.

## Bedienung

Auf **Analyse** liegt die instrumentübergreifende Fibonacci-Auswertung. Auf jeder **Instrumentseite** erscheint dieselbe Auswertung auf dieses Instrument begrenzt. „Beobachtung“ öffnet das Formular. Ein Trade ist keine Voraussetzung.

1. Instrument, Welle, Wellengrad, Zeiteinheit und Beobachtungsdatum wählen.
2. Tatsächlich gemessene Tiefe direkt in Prozent eingeben oder Anfang/Ende der Referenzbewegung und das folgende Korrekturextrem eintragen. Preise müssen dieselbe Währung, Bereinigung und Kursskala verwenden. Dezimalwerte über das Zahlenfeld eingeben.
3. Messnotiz/Quelle mit konkretem Zeitraum, Referenzpunkten und Abschlusskriterium ergänzen. Eine Welle je Wellengrad und Zeitraum einmal erfassen. Erreicht die laufende Welle ein neues Extrem, dieselbe Messung bearbeiten.
4. „Laufend“ ist vorbelegt. Erst eine tatsächlich abgeschlossene Welle auf „Abgeschlossen“ setzen; dies ist eine eigene bestätigte Einordnung. Es gibt keine automatische Elliott-Erkennung. „Ungültig“ nimmt den Fall aus der Statistik und erhält ihn im Protokoll.
5. „Speichern“ schreibt und liest den gespeicherten Datensatz serverseitig zurück. Die Stift-Schaltfläche lädt die aktuelle Messung in den Editor. Bei einem Versionskonflikt den aktuellen Stand neu laden, bevor die Korrektur wiederholt wird.

Filter: Instrument, Anlageklasse, Welle, Wellengrad, Zeiteinheit und inklusiver Zeitraum. „Übergeordnet“ umfasst die Gesamtstichprobe über Instrumente sowie die Auswahl höherer Wellengrade. Aktien und Krypto sind separat filterbar. Der CSV-Export enthält alle zur Auswahl passenden Beobachtungen einschließlich Status und exakter Werte, nicht nur die sichtbare Protokollseite. UTF-8 mit BOM, Semikolon, korrekt maskierte Texte und Formelpräfixschutz; Zahlen verwenden einen Dezimalpunkt. Keine Positions- oder Geldbuchung wird verändert.

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
