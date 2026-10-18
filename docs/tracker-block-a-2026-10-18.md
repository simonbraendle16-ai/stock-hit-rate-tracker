# Tracker-Arbeitsblock A – T0 bis T2, 18.10.2026

Implementierung im isolierten Branch `feat/tracker-block-a-20261018`, Basis `b00d9c0`. Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker`. Worktree: `C:/Users/sabin/Documents/Trading-Assistent/.worktrees/tracker-block-a`. Der Folgeauftrag autorisiert nach dem Kreuzverhör ausdrücklich die Übernahme und den Push auf `main`. Keine produktive Migration und keine persönlichen Datenänderungen. T3–T7 nicht als abgeschlossen behandeln.

## T0 – Ausgangslage

Hauptcheckout sauber, Verweildauer-Ausbau bereits in Basisrevision. Vollständige Soll-Ist-Matrix vor fachlicher Codeänderung im Projekt-Gesamtplan unter Abschnitt 6 gespeichert und rückgelesen. Ausgangstest unverändert: acht Testdateien / 86 Tests bestanden (10:57, 4,91 s). Sandboxstart zunächst `spawn EPERM`; freigegebener Prozessstart funktioniert. Vorhandene vollständige Testinstallation aus `tracker-zielzone` per Junction genutzt, weil der Hauptcheckout PGlite nicht auflöste. Schutzmechanismen unverändert. Codegraph nicht als Werkzeug verfügbar; gezielte direkte Quellprüfung.

## T1 – Zuordnung und Verknüpfungen

- Gemeinsamer Ladeweg `loadOwnedResearchTrades`: eigenes Trade- und Depoteigentum, bekannte Depotart. Depot ist maßgeblich, `kindMismatch` zeigt widersprüchliche abgeleitete Felder; keinerlei Datenkorrektur.
- Allgemeine qualitative Handelsauswertung und Abdeckung getrennt nach `money`/`demo`, Status weiterhin separat. Bisherige gemischte API-Felder bleiben erhalten und ausdrücklich dokumentiert.
- Beobachtungs-ID statt Kontext-ID für Revisionserkennung; neueste Version vor Filtern. Eigenständige IDs werden lesend nicht zusammengelegt. Bestehender Schreibvertrag, Kontext-/Messartindex, Quellen-Wiederholungsschutz und Versionsschutz bleiben unverändert.
- Zulässige Tradeverknüpfung verlangt passenden eigenen Trade und Instrument. Trade-ID je Kennzahl einmal, Trade-Status unabhängig vom Wellenstatus. Fremde Depotzuordnungen und Instrumentabweichungen werden ausgeschlossen. Verknüpfungsbasis enthält IDs und Gründe.
- Historische Simulation verwendet ausschließlich vorhandene hypothetische Angaben und Stopvarianten; keine Kopie oder Tradeanlage. Prognosebestand `assessment` bleibt eigenständig.
- Gemeinsames `fibonacciReadModel` in API, internem Loader und UI; Instrumentkarten ebenfalls an die gemeinsame Depotprüfung angeschlossen.

## T2 – Verwendbarkeit und laufende Wellen

- `runningStatsByKind`: explizit vorläufige Beschreibung von Struktur, Wellenrichtung, historischer Zeit, berichteter Dauer/Verweildauer, Zonen, erreichten/verfehlten Levels und Messbezug. Keine endgültigen Extreme, Endlevelverteilung oder Abschlussquote.
- Kennzahlbezogene IDs, Fallzahl, Bezugsmenge und Ausschlüsse in Forschungsabdeckung, Simulation und Handelskennzahlen. Neue Prozentzonen enthalten IDs je gemessener Zone/erreichter Schwelle und ihren Nenner. Levelprofile nennen auch ausgeschlossene IDs.
- Fehlende Dauer oder exakte Prozentmessung blockiert keine passende qualitative Kennzahl. Unbekannte Werte bleiben unbekannt. Hypothetisches CRV, aktuelles Plan-CRV, Eröffnungsplan-CRV, realisiertes R, qualitativer Ausgang und Nettoergebnis bleiben verschieden.
- Keine Währungssummen über Währungen hinweg. Fehlende Kontowährung sperrt die davon abhängigen Netto-/R-Kennzahlen.
- UI verwendet bestehende Komponenten: neuer Tab „Laufend & Simulation“, getrennte Demo-/Echtgeldgruppen und ausdrücklich benannte Abschlussabdeckung. Allgemeine Handelsdaten weisen aus, dass Wellenfilter dort nicht gelten.

## Verbindliche Prüffälle

| Anforderung | Nachweis |
|---|---|
| Demo und Echtgeld desselben Instruments getrennt | Neue isolierte Service-/API-Prüfung und Browser: Demo 100 %, Echtgeld 0 %, absichtlich falsche Trade-Felder sichtbar |
| Hypothetischer Gewinn ändert keinen tatsächlichen Gewinn | `fibonacci-read-model.test.ts`: Simulation unabhängig von Tradebestand/Netto |
| Mehrere Beobachtungen mit einem Trade zählen ihn einmal | Pure Read-Model- und echte PGlite/API-Prüfung |
| Eigenständige IDs mit gleichem Kontext bleiben getrennt | Berechnungs- und isolierter Lesetest; bestehender Schreibindex wird nicht erweitert |
| Revision ersetzt nur dieselbe Beobachtung | Revision vor Status-/Messartfilter geprüft; bestehende DB-Revisions-/Korrekturtests erhalten |
| Unvollständige Fälle bleiben verwendbar | Level-/Zonen-/Strukturfälle ohne Prozent/Dauer, eigene Einschluss-/Ausschluss-IDs |
| Laufende Fälle getrennt von Abschlussverteilungen | Berechnungstests und echter Browserfilter „Laufende Wellen“: Abschlussmessungen 0, beschreibende Struktur/Zone/Level weiterhin enthalten |
| Fremde Depots/Trades und unzulässige Links ausgeschlossen | Eigener Trade an fremdem Depot, fremder Trade an eigenem Depot, Instrumentabweichung, bestehende API-Eigentumstests |
| Verweildauer und Löschschutz erhalten | Bestehende residence/evidence/DB-Suite; Browser „unter 1 Tag“, unbekanntes Verhalten nicht als Nein gezählt |
| Alte API-Felder, neue Gruppen und Pagination | API und interne Action feldgleich; limit=1 reduziert nur Fallliste; Wellenfilter ändern allgemeinen Tradebestand nicht |
| Sortierung ändert keine Statistik | Unveränderter Workspace-Test entdeckte unsortierte neue Nachweis-IDs; stabil sortiert, Fehler behoben |

## Ausgeführte Prüfungen

- Finale Gesamtsuite: **101 Testdateien / 1.458 Tests bestanden**, Vitest 4.1.10, 18.10.2026 11:13:29, 33,68 s, `--maxWorkers=2`. Sieben neue gezielte Tests, zwei bestehende Assertions auf additive Kennzahlfelder erweitert.
- Ein erster unbeschränkter Gesamtlauf scheiterte bei fünf parallelen PGlite-Setups am 30-s-Limit; mit zwei Prozessen vollständiger Erfolg, keine Timeoutgrenzen oder Schutzmechanismen verändert.
- Finaler Produktionsbuild `next build --webpack` bestanden (32 statische Seiten, Kompilierung 12,8 s). Separate Typprüfung `node node_modules/typescript/bin/tsc --noEmit` bestanden; sie wurde zusätzlich ausgeführt, da die bestehende Next-Konfiguration Typprüfung beim Build überspringt. `git diff --check` ohne Fehler.
- Browser: echte verbundene Edge-Sitzung auf localhost:3018, flüchtige PGlite-Datenbank auf localhost:5548; Anmeldung mit ausschließlich synthetischem Konto. Laufende Angaben, strikte Dauerobergrenze, fehlende Abschlusswerte, getrennte qualitative und Nettoergebnisse, Planstatus, Abweichungshinweis und Instrumentkarten geprüft. Screenshots: [laufende Wellen](block-a-qa/running.png), [Tradegruppen](block-a-qa/trades.png).
- Browserbefund korrigiert: Instrumentkarten nutzten zunächst weiterhin das abgeleitete Trade-Feld; jetzt gemeinsamer Depotladeweg und Regressionstest.
- Lokale QA-Probleme: fehlerhafte Seed-Verknüpfung und fehlende Revisionsinkremente wurden von bestehenden Schutzprüfungen abgewiesen und im Seed behoben. Ein späterer lokaler Socket-Abbruch (`ECONNRESET`) verschwand nach Reload; keine dauerhafte Ursache behauptet. Finale Sichtprüfung erfolgreich, QA-Prozesse beendet, localhost-Testports geschlossen.

## Grenzen und Rücknahme

Technische Prüfung und gesondert autorisierte Veröffentlichung; eine produktive Abnahme folgt erst am veröffentlichten Stand. Zeitfilter, Endlevelsuche, Hierarchieausbau und Design bleiben spätere Blöcke. Bestehender Schreibschutz erlaubt weiterhin nicht beliebig mehrere gleichartige Messungen im selben Kontext; dieser Block korrigiert die lesende Zählung und erweitert keine Schreibrechte.

Rücknahme: eigenen Block-Commit auf dem isolierten Branch gezielt revertieren. Keine Datenrückmigration erforderlich. Vor einer späteren Übernahme Hauptstand und parallele Änderungen erneut prüfen; Hauptcheckout und andere Projektänderungen nicht zurücksetzen. Testwerkzeuge über lokale Junctions sind nicht Teil der veröffentlichten Anwendung.

## Kreuzverhör und Restabschluss am 18.10.2026

Die Ursprungssession `01a14e39-5e26-7f10-8175-3cd4f5f32e09` wurde bis zum letzten Ereignis gelesen. Sie endete am Nutzungslimit, nachdem die Korrekturen und 1.462 Tests vorlagen, aber vor Abschlussdokumentation, Commit und Push. Der spätere Prozessabschluss der lokalen Vorschau ist kein Veröffentlichungsnachweis.

Belegte Lücken und Korrekturen:

- Realisiertes R verlangt ursprüngliches Risiko mit gültigem eingefrorenem Währungsbezug, jedoch kein Kursziel. Plan-CRV bleibt unabhängig von Positionsgröße und Geldabrechnung. Fehler- und Gegenfälle für fehlendes Ziel, fehlende Menge, ungültigen FX-Kurs und fehlende Währung bestehen.
- Dokumentierte hypothetische CRV-/Exitplanangaben laufender Wellen bleiben verwendbar. Hypothetische Ausgänge und Ergebnisvarianten bleiben abgeschlossenen Beobachtungen vorbehalten; ungültige Fälle ausgeschlossen.
- Verknüpfte Geldsamples müssen Instrument und geprüfter Depotart entsprechen. Fehlende oder abweichende Samples haben eigene Ausschlussgründe und nachvollziehbare Bezugsmenge.
- Der isolierte Integrationstest wendet die vollständigen relevanten Fibonacci-Migrationen an und prüft den tatsächlichen Kontext-/Messartindex mit einem abgewiesenen Duplikat. Keine Erweiterung der Schreibrechte.

Frische Abschlussprüfung: **101 Testdateien / 1.462 Tests bestanden**, 18.10.2026 15:38:08 lokal, 39,53 s, `--maxWorkers=2`. Produktionsbuild `next build --webpack` (32 statische Seiten), separate Typprüfung `tsc --noEmit` und `git diff --check` bestanden. Die Sandbox verhinderte zunächst Test-/Build-Unterprozesse mit `spawn EPERM`; freigegebene Ausführung bestand ohne Abschalten von Schutzmechanismen. Der Build meldete fehlende lokale Better-Auth-Umgebungswerte; er wurde mit Exitcode 0 abgeschlossen. Das ist keine Prüfung produktiver Authentifizierung.

Erneute echte Edge-Browserprüfung am Produktionsbuild mit flüchtiger lokaler PGlite-Datenbank und ausschließlich synthetischem Konto: eine laufende Retracement-Welle bleibt vorläufig; Simulation zeigt CRV 12/24 gegenüber 11/24 in der Abschlussabdeckung, hypothetischen Exit und CRV-Bezug jeweils 1/24, abgeschlossenen hypothetischen Ausgang unverändert 1/24. Screenshot und DOM im Abschlusschat geprüft. Keine persönlichen Daten als Testbestand.

Vor der Übernahme: führender Hauptcheckout sauber auf `b00d9c0`; GitHub `refs/heads/main` frisch ebenfalls `b00d9c064634af50c2d98cd7a4068c6114aeeaac`. Veröffentlichung nur als normaler Fast-forward ohne Force-Push. Tatsächliche Commit-, Push- und Produktionsnachweise werden nach Ausführung im Projekt unter `00_Planung/Tracker-Technikplan-2026-10-18.md` ergänzt. Rücknahme umfasst den Implementierungscommit `f0fdd29` und den anschließenden Korrekturcommit in umgekehrter Reihenfolge.
