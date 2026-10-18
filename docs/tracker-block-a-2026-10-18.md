# Tracker-Arbeitsblock A – T0 bis T2, 18.10.2026

Lokale Implementierung im isolierten Branch `feat/tracker-block-a-20261018`, Basis `b00d9c0`. Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker`. Worktree: `C:/Users/sabin/Documents/Trading-Assistent/.worktrees/tracker-block-a`. Kein Push, keine produktive Migration und keine persönlichen Datenänderungen. T3–T7 nicht als abgeschlossen behandeln.

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

Nur lokale Implementierung und technische Prüfung. Keine Veröffentlichung, produktive Abnahme oder Änderung persönlicher Daten. Zeitfilter, Endlevelsuche, Hierarchieausbau und Design bleiben spätere Blöcke. Bestehender Schreibschutz erlaubt weiterhin nicht beliebig mehrere gleichartige Messungen im selben Kontext; dieser Block korrigiert die lesende Zählung und erweitert keine Schreibrechte.

Rücknahme: eigenen Block-Commit auf dem isolierten Branch gezielt revertieren. Keine Datenrückmigration erforderlich. Vor einer späteren Übernahme Hauptstand und parallele Änderungen erneut prüfen; Hauptcheckout und andere Projektänderungen nicht zurücksetzen. Testwerkzeuge über lokale Junctions sind nicht Teil der veröffentlichten Anwendung.
