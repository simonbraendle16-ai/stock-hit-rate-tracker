# Messoberfläche: Kritik, Umsetzung und finale Abnahme

Nutzerauftrag vom 16.10.2026: grafische Oberfläche/Übersicht gründlich mit Kreuzverhör prüfen und für schnellere, verständlichere Messarbeit aufwerten. Ergänzend ausdrücklich beauftragt: nach Fertigstellung direkt auf `main` pushen, alles dokumentieren und **vor dem Push erneut Kreuzverhör und Validierung** durchführen.

## Ergebnis und kurze Bedienübersicht

1. Im Cockpit **Wellen messen** öffnen oder unter **Analyse → Wellenforschung** beginnen.
2. Oben stehen Auswahlgröße, tatsächlich auswertbare Messungen, Median und fehlende Messwerte. „—“ bedeutet unbekannt; echte null Prozent bleiben „0 %“.
3. Instrument, Messart, Welle und Zeiteinheit auswählen. Die Suche findet Instrument, Wellenlabel, Quelle, Struktur und Messnotizen. **Arbeitsauswahl → Ohne Messwert** zeigt die noch zu ergänzenden Fälle. Zusätzliche Filter für Wellengrad, Status, Anlageklasse und Datum sind aufklappbar.
4. **Neue Beobachtung** übernimmt den ausgewählten Instrument-/Wellen-/Grad-/Timeframe-/Messartkontext. Der neue Status bleibt bewusst „Laufend“; ein Filter erklärt eine Welle nicht automatisch für abgeschlossen. Das Formular gliedert sich in Wellenzuordnung, Messwert und Herkunft/Zeitraum. Struktur, Stopvarianten und Tradeverknüpfungen sind weiterhin erreichbar, aber nachgeordnet. Bei Expansion bleibt die Bezugsbasis sichtbar erforderlich.
5. Im **Messprotokoll** Fälle sortieren, **Quelle & Messdetails** aufklappen und über **Bearbeiten** denselben Fall korrigieren. Auf dem Smartphone haben die Fälle eigene Karten und direkt erreichbare Bearbeitungstasten.
6. **Verteilungen**, **Strukturen & Stops**, **Tradebezug** und **Kursdaten** sind separate Ansichten derselben Untersuchung. **CSV der Auswahl** exportiert genau den durch Suche und Filter ausgewählten Bestand. Die Sortierung ändert die Kennzahlen nicht.
7. **Auswahl zurücksetzen** setzt Suche, Arbeitsauswahl und Filter zurück; eine fest an die Instrumentdetailseite gebundene Instrument-ID bleibt erhalten. Prognosen und Instrument-Gesamtwerte unterhalb des Arbeitsbereichs haben ihre eigene, ausdrücklich benannte Grundgesamtheit.

## Kritikpunkte und konkrete Änderungen

| Befund | Änderung | Nutzen |
|---|---|---|
| Prognose-/Tradezahlen standen vor dem eigentlichen Messablauf; Protokoll erst nach langen Diagrammabschnitten | Analyse in Wellenforschung, Prognosen und Instrumente gegliedert; Messprotokoll als erste Ansicht; direkter Einstieg im Cockpit | Der nächste sinnvolle Arbeitsschritt ist sichtbar, ohne mehrere Statistikblöcke zu durchlaufen. |
| Keine Textsuche; lange Quellen-/Notiztexte dominierten jede Zeile | Gemeinsame Such-/Filterpopulation, Sortierung und aufklappbare Details | Fälle schneller wiederfinden; Herkunft bleibt vollständig prüfbar. |
| Mobile Bearbeitung erforderte horizontales Scrollen einer breiten Tabelle | Mobile Fallkarten mit Messwert, Status, Kontext und Bearbeiten | Der Bearbeitungsknopf bleibt im sichtbaren Kartenbereich. |
| Unbekannte Prozentwerte wurden mit angehängtem Prozentzeichen dargestellt; beschreibende abgeschlossene Fälle im Leertext falsch erklärt | Einheitliche Prozentformatierung; eigene Auswahl ohne Messwert; präziser Leerzustand und Rückweg zum Protokoll | Fehlender Wert, laufende Welle und echter Nullwert werden getrennt. |
| Überschrift „Retracement“ erschien auch für Expansionen | Messartabhängige Überschrift, konsequente gemeinsame Population und richtige Formularvorbelegung | Messarten bleiben auch beim Erfassen aus der gefilterten Ansicht getrennt. |
| Viele optionale Felder vor der erforderlichen Messnotiz; langer Dialog verlor Orientierung | Drei sichtbare Kerngruppen, optionale Ergänzungen aufklappbar; feste Dialogüberschrift und Aktionsleiste mit eigenem scrollenden Feldbereich | Quelle und Kernmessung zuerst, Speichern/Abbrechen auf kleinen Bildschirmen erreichbar. |
| Tastaturwechsel benötigte gesondertes Aktivieren | Register aktivieren sich beim Pfeiltastenfokus; Schließen-Schaltfläche deutsch beschriftet | Direkter Wechsel zwischen sofort verfügbaren Ansichten. |

Bestehende IBM-Plex-Schriften, Indigo-Nacht und semantische Farbtokens erhalten; vorhandene shadcn-/Base-UI-Bausteine verwendet. Keine neuen Handelsregeln, Kennzahlformeln, API-Felder oder Datenmigrationen. Die Reihenfolge-/Suchlogik liegt separat und wird mit den bestehenden `fibStats`-/CSV-Funktionen kombiniert. API-Berechtigung, stabile Erfassungs-ID, Versionsschutz und Rücklesen bleiben im bestehenden Serverpfad.

## Erneutes Kreuzverhör unmittelbar vor Veröffentlichung

**Behauptung: schneller handlungsfähig, ohne die Datenbedeutung zu verändern.**

- **Sehe ich dieselben Fälle in Protokoll, Statistik und CSV?** Eine gemeinsame `selectResearchRows`-Population speist alle drei. Echter Browserexport nach Suche enthält genau die neun passenden synthetischen Fälle; Gegenfälle werden ausgeschlossen. Reine Sortierung verändert die Population oder ihre Kennzahlen nicht.
- **Macht die Oberfläche aus einer Zone oder einem fehlenden Wert eine Messung?** Nein. Tests unterscheiden `null` von echter `0`; fehlende abgeschlossene Werte erzeugen keinen numerischen Nenner. Der ausschließliche beschreibende Bestand bleibt nutzbar und bekommt eine konkrete Ergänzungshilfe.
- **Verliere ich Angaben beim Korrigieren oder Zuklappen?** Die vorhandenen Formularzustände bleiben erhalten. Echter lokaler Browserdurchlauf bestätigt dieselbe Beobachtungs-ID, Version 1 → 2, korrigierten Wert und unveränderte Quelle/Zeitraum. Abbrechen verändert die Version nicht. Keine neuen Fälle bei Korrektur.
- **Ist „Mobil passt“ nur ein Breitentest?** Zusätzlich wurden alle fünf Ansichten sowie die Bearbeitung real bedient. Eine nachträgliche Sichtprüfung entdeckte, dass Fokus in tiefen Formularfeldern die Aktionsleiste aus dem sichtbaren Bereich schieben konnte. Korrigiert durch einen eigenen Scrollcontainer um das Fieldset. Die finale Prüfung kontrolliert obere und untere Grenzen **und** den tatsächlich anklickbaren Mittelpunkt der Speichertaste. Screenshot bestätigt sichtbare Überschrift und Tasten.
- **Ist ein hoher Fallzähler schon belastbare Forschung?** Nein. Beobachtungen, numerisch auswertbare Messungen und fehlende Werte sind getrennt. Explorative Auswahl und Grenzen bleiben erklärt. Prognose-/Instrument-Gesamtwerte sind außerhalb der Messfilter ausdrücklich beschriftet.
- **Haben die neuen Ansichten Funktionen versteckt oder entfernt?** Die bisherigen Verteilungen, Schwellenprofile, Wellen-/Instrumentvergleiche, Strukturen, Stops, Trade-Kennzahlen, CSV und historischen Kurse bleiben erreichbar. Zusätzliche Filter und Details sind beschriftet und aufklappbar. Ein Bezug zum aktuellen Chart wird nicht behauptet.

**Urteil:** Für den beauftragten Messablauf hinreichend geprüft; kein belegter blockierender UI-Fehler mehr offen. Tests beweisen keine zukünftige subjektive Zeitersparnis. Der erste persönliche numerische Messdurchlauf bleibt weiterhin ein fachlicher Praxisschritt.

## Finale Soll-Ist-Validierung vor dem Push

| Anforderung | Nachweis / Ergebnis |
|---|---|
| Gründliche Kritik und tatsächliche Umsetzung | Obige Befunde jeweils mit Änderung und Gegenprüfung; gemeinsamer Workspace, Protokollkomponente, Auswahl-/Sortierlogik und Formular angepasst. |
| Schneller Messzugang und klare Übersicht | Lokale Sichtprüfung vor/nach Änderung; Hauptaktion, Datenbasis und Protokoll vor Diagrammdetails; Cockpit-Verweis hinzugefügt. |
| Desktop und Mobil bedienbar | Vollständige lokale authentifizierte Anwendung bei 375, 390, 768 und 1440 CSS-Pixeln. Alle fünf Ansichten ohne globale Überbreite, Bearbeiten und Abbrechen geprüft. |
| Suche, CSV und Nenner konsistent | Drei neue Logiktests plus Browserexport und unveränderte Metriken bei Sortierung. |
| Speichern und Korrigieren funktionieren | `node scripts/verify-research-workspace.mjs` gegen feste Loopback-App und isolierte PGlite-Datenbank: neun Abschlussprüfungen bestanden, einschließlich echtem Browser-Schreiben, DB-Rücklesen und gefilterter Statistik. [Maschinenlesbares Ergebnis](research-workspace-ui-results-2026-10-16.json). |
| Bestehende Funktionen erhalten | Vollständige finale Suite: **95 Dateien / 1.408 Tests bestanden**. |
| Unabhängige Typprüfung | `node node_modules/typescript/bin/tsc --noEmit`, Exit 0, nach Entfernen der temporären Vorschauseite. |
| Produktionsbuild | `node node_modules/next/dist/bin/next build`, Exit 0; Build überspringt Typprüfung, deshalb obiger unabhängiger Nachweis. Kein QA-Routenpfad im Build. |
| Keine persönlichen Testdaten / Produktionswrites | Alle Browser-Schreibprüfungen ausschließlich `localhost:3018` und `127.0.0.1:5548`, fest geprüfter synthetischer Besitzer. Keine produktive Messung, Order oder Bewertung geschrieben. |
| Prüfmittel bereinigt | Temporäre Vorschauseite entfernt, private QA-Browser und lokale Test-App beendet; vorhandene Server-/Produktionsprozesse nicht neu gestartet. Testabhängigkeiten ausschließlich im lokalen ausgeschlossenen Testordner, keine Paket-/Lockdateiänderung. |
| Dokumentation und Pushfreigabe | Dieser Bericht, Screenshots, Testskript und Ergebnisdatei gehören zum geprüften Commit. Nutzer hat Push auf main ausdrücklich freigegeben, Bedingung erneutes Kreuzverhör/Validierung hier erfüllt. |

## Sichtnachweise

Die Bilder zeigen ausschließlich synthetische Fälle der lokalen Anwendung; sie sind keine persönlichen Messwerte und kein angemeldeter Produktionsnachweis.

- [Desktop-Arbeitsbereich](research-ui-2026-10-16/desktop.png)
- [Mobile Fallkarten](research-ui-2026-10-16/cards-390.png)
- [Mobiler Dialog mit festem Kopf und sichtbaren Speichertasten](research-ui-2026-10-16/mobile-form.png)

Die eingebauten Browser-/Computer-REPL-Werkzeuge scheiterten am fehlenden Runtime-Pfad (OS-Fehler 3). Sichtprüfungen deshalb über den vorhandenen lokalen Browser-CLI-Weg und dessen privaten QA-Browser. Die erste Konfigurations-/Prozessbeschränkung der Tests ist kein App-Defekt; danach unveränderte vollständige Suite außerhalb dieser Prozessbeschränkung bestanden. Frühe QA-Skriptfehler (mehrdeutiger Heading-Locator und zu schwache Sichtbarkeitsgrenze) wurden im Testskript korrigiert; der dabei tatsächlich aufgedeckte mobile Scrollfehler wurde in der Oberfläche behoben und erneut geprüft.

## Wiederholbarer lokaler Browserlauf

Vorhandenes `scripts/fibonacci-local-preview.mjs` mit lokalen Testabhängigkeiten gemäß dessen Kopfkommentar starten. Anschließend `node scripts/fibonacci-browser.mjs open http://localhost:3018/sign-in` und `node scripts/verify-research-workspace.mjs`. Das Skript verwendet ausschließlich feste lokale HTTP-/SQL-Ziele und den synthetischen Besitzer, lädt keine Produktions-Env-Datei und legt seine Ergebnisse unter `.test-tools/research-ui-results` ab. Die vorgegebene lokale Browserinstallation entspricht dem vorhandenen CLI-Prüfweg. Danach QA-Browser schließen und die gestartete Vorschau beenden.

## Veröffentlichung und verbleibende Grenzen

Ausgangsbasis Tracker-`origin/main`: `567901f27e7eb981f83fcdcbcb8386f72583d125`. Isolierter Branch `codex/research-ui-2026-10-16`. Der nach diesem Abgleich erstellte Commit wird normal nach `main` gepusht; Remote-SHA, Deployment und Projektbericht werden anschließend frisch geprüft. Keine Force-Pushes und keine fremden uncommittierten Arbeiten.

Produktive Browserabnahme mit angemeldetem Nutzer ist durch die lokale Sichtprüfung nicht ersetzt. Persönliche Messungen, echte Kosten-/Brokerbelege, BAYN-Originalkurse und Cron-Gesamtabnahmen bleiben die bereits dokumentierten fachlichen/Betriebsreste. Rücknahme bei neuem konkretem Fehler gezielt über den UI-Commit, ohne Datenrückbau oder Änderung von Messungen.
