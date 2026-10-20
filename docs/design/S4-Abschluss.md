# S4 – Panorama und gemeinsame Statistikmodule

Stand 20.10.2026. Basis: veröffentlichter Main `af1b9b2` plus erhaltene S1–S3-Designarbeit; Integration `710416a`. Auftrag: genau nächste Session S4 abschließen, Kreuzverhör durchführen, betroffene Unterlagen nachziehen und ausdrücklich auf Main pushen. Dieser neue Pushauftrag zieht die Auslieferung des vorhandenen Zwischenstands vor; die ursprüngliche Bündelung bis S10 und eine vollständige Forschungsabnahme sind damit nicht als erledigt behauptet.

## Ergebnis

`research-panorama.ts` adaptiert `fibStats` aus `researchResult.selected`, unabhängig von Tabellenpagination. Retracement und Expansion haben eigene Ergebnisgruppen. `ResearchPanorama` zeigt dokumentierte Umkehrpunkte/-bereiche, Levelerreichungen mit eigenen Nennern, erwartete Zielzonen nach Erwartungszeitpunkt, Strukturfamilien, unabhängige Unterteilung/Mustersicherheit und explizite B-/C-Varianten. Einheiten, Werte, n und Ausschlüsse sind als Text sichtbar; native Titel ergänzen die Balken. Fehlende Grundlage ist keine Nullquote. Keine IDs, Notizen oder Einzelfälle in der Statistikfläche; vorhandener Datengrundlagenzugang bleibt geschlossen.

Laden, ungeklärte Suche, ungültige Auswahl, echte leere Auswahl und teilweise verwendbare Daten haben getrennte Zustände. `/analysis` und `/tracking` besitzen zusätzlich Lade-/Fehlergrenzen für echte Server-Lesefehler. Erneut laden ruft dieselbe Suchadresse vollständig neu ab.

## Prüfung und Kreuzverhör

| Tragende Frage | Nachweis / Verbesserung |
|---|---|
| Werden nur die 20 sichtbaren Fälle gezählt? | Regression mit 47 Retracements plus Expansion über zwei Seiten und Reihenfolgen: identische volle Aggregate und IDs, Vergleich gegen vorhandenen Aggregator. |
| Werden Messarten oder fehlende Werte vermischt? | Getrennte Gruppen; bekannte 0 % von n=0 unterschieden; laufend/unklar/ungültig und fehlende Angaben je Kennzahl ausgeschlossen. |
| Werden Muster, Unterteilung und Varianten aus Prozentwerten geraten? | Ausschließlich vorhandene Katalogaggregate; bestätigte Unterteilung zählt auch ohne exakte Prozentwerte. Muster-/Unterteilungssicherheit und Varianten bleiben unabhängig. |
| Ist die Oberfläche prüfbar, ohne Fälle aufzudrängen? | Beschriftete Balken, n, Nenner/Ausschlüsse; keine IDs im Panorama. Geschlossene Datengrundlage im Browser bestätigt. |
| Hilft die Fehlerkarte auch bei einem echten Datenfehler? | Ursprüngliches `reset()` stellte die Serverdaten nicht wieder her. Durch vollständiges Neuladen gleicher Adresse ersetzt; echter lokaler Tabellenausfall, Fehleranzeige und erfolgreiche Erholung geprüft. |
| Ist die kompakte Ansicht tatsächlich lesbar? | Leere Musterfamilien platzsparend zusammengefasst; bestätigte Nullquoten bei Levelerreichung erhalten. 1440/1024/390 px ohne globale Überbreite, Screenshots gelesen. |
| Belegen grüne Tests tatsächlich den Umfang? | Neuer Test zunächst außerhalb `*.test.ts`-Discovery erkannt und in den richtigen Suchpfad verschoben. Final 110 Dateien / 1.629 Tests bestanden; 187 relevante Regressionen separat; TypeScript und finaler Webpack-Produktionsbuild bestanden. |

10 neue reine Modell-/Renderprüfungen. [Browsernachweis](s4/browser.json): 9/9 Prüfgruppen einschließlich echten Serverfehlers und Wiederholung; [Desktop](s4/panorama-1440.png), [1024 px](s4/panorama-1024.png), [Mobil](s4/panorama-390.png). Alles synthetisch in flüchtiger lokaler PGlite-Datenbank; Bestand/Versionen unverändert. Keine produktiven Schreibtests.

Regulärer CUA-Browser lieferte Desktop-DOM und Sichtprüfung; anschließend CDP-Deadline, verlorene Tabzuordnung und neuer Tab mit Timeout. Vorhandener Playwright-Rückfall nur für die verbliebenen lokalen S4-Prüfungen. Fehlende lokale Drizzle-Peerauflösung auf die bereits vorhandene PGlite-Testinstallation verknüpft; kein Paket-/Lockfilewechsel. Erste falsche Test-Sollerwartung und mehrdeutigen Prüflocator korrigiert; keine Produktlogik daran angepasst. Build/Testlauf und Vorschau nacheinander, damit kein laufender Previewserver alte Buildartefakte verwendet.

## Grenzen und Rücknahme

S3-Browserabnahme bleibt ausdrücklich gestoppt und offen; ihre Wechsel-/Reload-/History-/Detailfälle wurden nicht als S4-Abnahme nachgeholt. S5 Statistikstudio, S6 Strukturvergleich, S7 Zeit-/Dauermodule, S8 Detailgestaltung und S9 Gesamtprüfung bleiben weitere Planabschnitte. Kalender-/Dauerverträge unverändert erhalten, neue Zeitgrafiken hier nicht behauptet. Keine neue Handelsregel, Kosten, Brokeraktion, persönliche Buchung, Skill- oder Hookänderung.

Auslieferung und aktueller Produktionsnachweis stehen im Trading-Assistenten unter `06_Integrationen/Tracker-Design-S4-Abschluss-2026-10-20.md`. Rücknahme nur der S4-Änderungen anhand ihrer Revision; für die gesamte vorgezogene Designauslieferung ist `af1b9b2` die letzte veröffentlichte Basis. Neuere Nutzerarbeit erhalten; kein Reset oder Force-Push.
