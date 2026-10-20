# Design S5 – Statistikstudio, Kreuzverhör und Auslieferung

Stand 20.10.2026. Auftrag: nächsten Abschnitt des bestehenden Plans abschließen, kritisch prüfen, Verbesserungen übernehmen, Main pushen und betroffene Dateien nachziehen. Maßgeblich: S5 / U4 zweiter Teil. Basis des führenden Trackers und des isolierten Worktrees `.worktrees/tracker-studio`: `470a6ea`.

## Ergebnis und Prüfung

Statistikstudio zeigt dieselben sechs Statistikmodule und dasselbe einmal berechnete `panoramaModel` wie das Panorama. Größere einspaltige Module; je Verteilung beschriftete Balken und zugängliche Tabellen nebeneinander, auf schmalen Geräten untereinander. Anzahl, eigener Nenner und Prozentanteil sichtbar. Levelerreichung und erwartete Zielzone zeigen zusätzlich ihre bekannten Gegenkategorien. Fehlende Angaben bleiben außerhalb des Nenners; Punktlevel, Bereiche, Messarten, Erwartungszeitpunkt, Muster, Unterteilungssicherheit und dokumentierte B-/C-Varianten bleiben getrennt. Keine neue Datenhaltung, Abhängigkeit, Migration oder Messdefinition.

110 Testdateien / 1.635 Tests bestanden. Sechs neue Studio-Prüfungen vergleichen die gemeinsamen Verteilungen, bekannte Nullquoten, fehlende Grundlagen, beide Messarten, Statusausschlüsse sowie Leer-/Lade-/Fehler-/ungeklärte Zustände. Nach Legendenkorrektur 16/16 gezielte Regressionen erneut bestanden. Separate Typprüfung und finaler Webpack-Produktionsbuild erfolgreich.

Echte Edge-Browserprüfung mit flüchtigem lokalem PGlite und ausschließlich synthetischen 48 Beobachtungen. 40 Retracements und 8 Expansionen getrennt; identische Figurenbeschriftungen/Nenner nach Ansichtswechsel; Panorama ohne Detailtabellen, Studio mit 22 Tabellen. Bei 1440, 1024 und 390 Pixeln kein globaler Überlauf, Tabellen und Balken tatsächlich angesehen. [Desktop](s5/studio-1440.png), [mittlere Breite](s5/studio-1024.png), [Mobil](s5/studio-390.png). Bestätigte dreiteilige Unterteilung gefiltert: 19 Retracement-Beobachtungen, 18 abgeschlossen, eigener bestätigter Nenner 18. Reload erhält Perspektive und Filter; Datengrundlage bleibt geschlossen. Leere Instrumentauswahl und unvollständiger Levelfilter zeigen keine alten Tabellen. [Prüfprotokoll](s5/browser.json).

## Kreuzverhör und Verbesserungen

| Tragende Frage | Beleg, Entscheidung und verbleibende Grenze |
|---|---|
| Entstehen zwei abweichende Berechnungen? | Beide Perspektiven erhalten exakt dasselbe Modell aus der vollständigen Auswahl. Nur Darstellung und bekannte Gegenkategorien ändern sich. Modell-/Rendervergleich und tatsächlicher Ansichtswechsel bestanden. |
| Werden fehlende Werte als Verlust oder 0 % behandelt? | Tabellen entstehen nur bei n > 0; unbekannte Ziele bleiben separat. Bekannte 0/1 und 1/1 ausdrücklich geprüft. Level sind Mehrfachangaben, keine addierbare Trefferquote. |
| Ist die ausführliche Ansicht nur ein zweites Panorama? | Einspaltige große Module mit direkten Zahlentabellen und Gegenkategorien ermöglichen genauere Prüfung. Keine neue Kennzahl nötig. Zeit/Dauer S7 und Gruppenmatrix S6 bleiben eigene Abschnitte. |
| Passt die Legende noch? | Im ersten Studioentwurf zeigte die alte Legende nur „Erreicht = Akzentbalken“, obwohl auch Verfehlungen einen Balken haben. Für Studio korrigiert, Panorama erhält seine passende Legende. Gezielte Regression und Rücklesen des finalen Builds. |
| Sind technische und produktive Abnahme dasselbe? | Nein. Lokale Daten-/Darstellungsprüfung bestanden; produktiver Datenabruf bereits vor S5 HTTP 503. Keine bestandene Produktionsdatenprüfung behauptet. |

Eigene Ausführungsfehler: Test-/Build-Unterprozesse zunächst durch Sandbox `spawn EPERM` blockiert, mit genehmigter Ausführung erfolgreich. Ein unnötiger `tsx`-Startparameter scheiterte; vorhandene Node-TypeScript-Unterstützung genutzt. Zwei inline Python-/JavaScript-Aufrufe scheiterten an Windows-Argumentquotierung; konkrete Korrektur über UTF-8-Dateiskript/gezielten Patch, ohne Produktwirkung. Künftige komplexe Änderungen direkt als Datei/Patch ausführen. Das sind Ausführungsfehler bei bereits ausreichenden Anweisungen, keine belegte neue Skilllücke. Keine künstliche Skill-/Hookänderung.

## Produktive Abnahmegrenze

Vor dem S5-Push mehrfach HTTP 503 bei rein lesendem Fibonacci-Abruf. GitHub zuletzt Production `7208688295`, SHA `470a6ea`. Vercel-Produktionslogs am 20.10. gegen 19:34 UTC belegen Datenbankfehler `53000`: Konto oder Projekt überschreitet eine Quote. Betroffen sind außerdem Sessionabfrage und Wissensmanifest. Konkrete Quotenart, Rücksetzzeit und kostenfreie Abhilfe sind nicht belegt. Kein neuer S5-Fehler, aber auch keine automatische Heilung durch Deployment versprechen. Kein Upgrade, keine Kostenänderung, kein automatischer Neustart/Suspend-Test. Aktueller Produktionsfingerabdruck konnte deshalb nicht erhoben werden; historische S4-Fingerabdrücke ersetzen ihn nicht.

## Fortsetzung und Rücknahme

Nächster Implementierungsabschnitt S6 – Strukturvergleich. Zuvor beziehungsweise unabhängig davon nach wiederhergestellter Datenbankverfügbarkeit frischen Produktionsabruf und angemeldete Studioansicht prüfen. S3-Browserabnahme bleibt gesondert gestoppt/offen; vollständige Forschungsabnahme erst in späteren Planabschnitten. S5 ist lokal geprüft; produktive Datenabnahme blockiert.

Rücknahme: ausschließlich den neuen S5-Commit mit neuem Revert nach Prüfung neuerer Änderungen zurücknehmen. Kein Force-Push, keine Rücksetzung fremder Arbeit, keine persönliche Datenänderung oder Migration.
