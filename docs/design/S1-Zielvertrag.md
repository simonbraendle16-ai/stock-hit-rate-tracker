# S1 – Basis und Zielvertrag

Stand 19.10.2026. Technische Ausarbeitung des bestätigten Abarbeitungsplans U0/U1; keine produktive UI-Implementierung und keine fachliche Nutzerabnahme. Auftrag dieser Sitzung: ausschließlich nächste Stufe S1 abschließen.

## Gesicherte Basis

- Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker`.
- Hauptcheckout und frisch gelesener Remotezweig `origin/main`: `36dec6ffa42f656088e00dad8bc6b55d2dc1e3ec`; Hauptcheckout vor Beginn sauber.
- Eigener Worktree: `C:/Users/sabin/Documents/Trading-Assistent/.worktrees/tracker-design`, Zweig `feat/tracker-design-20261019`, gleiche Basisrevision. Bestehende andere Worktrees erhalten.
- Kein eigenes AGENTS.md im Tracker oder den geprüften Vorfahren Documents / Agentic Coding / Apps gefunden. Globale und Trading-Projektregeln gelten.
- Next.js 16 / React 19 / Recharts 3 sind bereits vorhanden. Keine Bibliothek oder Abhängigkeit hinzugefügt. `node_modules` im neuen Worktree ist eine Junction zum vorhandenen Hauptcheckout; keine Installation, keine Umgebungsdateien kopiert.
- Angemeldete produktive `/tracking` im echten Edge-Browser gelesen und visuell geprüft. Ausgang: alter dunkler Cockpitkopf mit Depotwahl und neun Zielen, Forschungsfilter, ausgeklappte Kennzahlabschnitte und unmittelbar sichtbares Messprotokoll. Persönliche Werte/Fälle werden nicht in diese technische Dokumentation übernommen. Dies ist keine erneute vollständige Produktionsabnahme.
- Wissensdienst frisch: `initializationState=ready`, `active=true`, `pending=0`, kein aktueller Publisher-/Trackerfehler. Suche lieferte ältere/andere Planabschnitte; aktuelle Design-Originaldateien maßgeblich. Kein Neustart/Suspend-Test.

## Funktionskarte und Erhaltung

| Bestehende Funktion / Einstieg | Ziel und Zeitpunkt | Erhaltungsvertrag |
|---|---|---|
| `app/page.tsx`, Cockpit | Gesamtübersicht S11 | Bestehende Startadresse und Bereichszugänge erhalten |
| `components/cockpit-header.tsx`, `cockpit-nav.tsx` | Gemeinsamer Rahmen S2, endgültige Ordnung S11 | Authentifizierung, Abmeldung, Depotwahl und Hinweise erhalten; Forschung bleibt depotunabhängig |
| `/watchlist`, `/stock/[id]` | Instrumentzugänge im Rahmen | Instrumentdetail, Chart, Prognosen und kontextgebundene Fibonacci-Auswahl behalten |
| `/analysis` | Prognoseprüfung, Gestaltung S13 | Existierende Prognoseerfassung/-prüfung; keine Forschungsquote als Prognosetrefferquote ausgeben |
| `/tracking#fibonacci`, `FibonacciPanel` | Wellenforschung S3–S8 | Drei Perspektiven innerhalb derselben Forschung; vorhandene Links weiterhin auflösbar |
| `interpretFibSearch`, `researchResult` | Gemeinsame Suche S3 | Strukturierte Filter, Klärungen, Fehler und Exportblockade bleiben bindend |
| `use-fibonacci-location.ts`, `fibonacci-location.ts` | Such-/Detail-/Rückkehrzustand S3/S8 | `fib.tab`, Filter, Klärungen, Reihenfolge, Seite und Fremdparameter erhalten |
| `CategoricalFibForm`, Zeit-/Dauer-/Evidence-Eingaben | Datensammlung S12 | Bereits ab S2 weiterhin über Neue Beobachtung/bisherige Zugänge erreichbar; keine neue Datenhaltung |
| `FibonacciObservationList`, Details, Revisionen | Datengrundlage S8, Datensammlung S12 | In Forschung zunächst geschlossen; bestehende Detail-/Bearbeitungswege, GET und Versionsschutz erhalten |
| `researchCsv` / CSV der Auswahl | Export in Forschung | Vollständige geordnete Auswahl vor Pagination; unklare Suche sperrt Export |
| Altbestand, Strukturen & Stops | Ergänzende Forschungsgruppen | Exakte Maximalwerte, kategoriale Angaben und hypothetische Varianten getrennt zugänglich |
| Laufend & Simulation, Tradebezug, Kursdaten | Eigene ergänzende Fachansichten | `fib.tab` nicht zum Perspektivumschalter umdeuten; keine Mischung mit abgeschlossener Forschungsstatistik |
| `/trades`, `/trades/new`, Trade-/Einstiegsdetail, `/broker-orders` | Handelsbereich, Gestaltung S13 | Bestehende Pläne, Demo-/Echtgeldtrennung, Abrechnung und Brokerzugänge; keine neuen Brokeraktionen |
| `/tracking#ergebnis`, `#prozess`, `#muster` | Handelsauswertung S13 | Bestehende direkte Sprungziele erhalten; tatsächliche/hypothetische Ergebnisse und Depots getrennt |
| `/journal` | Eigener Zugang, S13 | Journal und Erkenntnisse erhalten; keine technischen Testeinträge |
| `/trainer`, `/trainer/frei`, `/trainer/[id]`, `/trainer/statistik` | Bestehende Nebenbereiche S13 | Alle bisherigen Routen erreichbar; kein neuer Trainerumfang |
| `/friends`, `/friends/[id]`, `/settings`, `/settings/assistant-api` | Neben-/Kontobereiche S13 | Bestehende Sichtbarkeits- und Zugriffsgrenzen beibehalten |
| `/sign-in`, `/sign-up` | Bestehende Anmeldung | Keine Änderung am Authentifizierungsvertrag |

Navigation in S2: Hauptzugänge beschriftet links, auf schmalen Geräten kompakt erreichbar. Alle neun heutigen Cockpitziele bleiben zugänglich; Datensammlung kann bis S12 über den vorhandenen Forschungs-/Formularzugang erfolgen. Die endgültige Zusammenfassung und Benennung der gesamten App erfolgt in S11, ohne bestehende URLs umzubenennen.

## Eine Auswahl, drei Kompositionen

Gemeinsame Reihenfolge: Referenzkopf → Referenzhero mit Suche → erkannte Kriterien/Filter und Klärungen → horizontale Reiter Panorama / Statistikstudio / Strukturvergleich → Datenbasis → perspektivabhängige Aggregate → geschlossene Datengrundlage. Desktopinhalt maximal 1440 px, links 175–200 px Navigation, Rest flexibles 12-Spalten-Raster, Abstand 20–24 px.

| Perspektive | Erste Module unter Auswahl und Reitern | Weiter unten |
|---|---|---|
| Panorama | Datenbasis über volle Breite; Umkehrlevel/-bereiche 8 Spalten, Strukturfamilien 4 Spalten | Levelerreichung und Zielzonenumkehr je 6; kompakter historischer Zeitkontext und getrennte Dauergruppen je 6; exakte Altbestandsmessungen ergänzend |
| Statistikstudio | Gleiche Datenbasis; große Umkehrverteilung volle Breite; klar getrennte Levelerreichung und Schlüsselfibonacci je 6 | Zielzonenvergleich und Strukturuntertypen je 6; historische Zeit volle Breite; Wellendauer / Umkehrdauer / Verweildauer als getrennte Gruppen; exakte Messungen in eigenem Modul |
| Strukturvergleich | Gleiche Datenbasis; Welle×Level-Matrix 8 und Strukturfamilien pro Gruppe 4 | Zielzonen je Vergleichsgruppe; historische Zeit und vergleichbare Dauergruppen; keine Einzelfallkarten oder Kursminiaturen |

Bei 1024 px Navigation kompakt, zwei Statistikspalten, Matrix lokal scrollbar. Bei 390 px einspaltig, Datenbasis 2×2 Karten, Suche volle Breite, Filter hinter beschriftetem Aufklapper; die drei beschrifteten Reiter in einer lokal horizontal scrollbar bleibenden Zeile. Keine abgeschnittenen Reiternamen oder globale Überbreite. Matrix erhält eigenen Scrollbereich und zugängliche Textwerte. Reihenfolge im DOM entspricht Lesereihenfolge. Tastaturfokus sichtbar; aktiver Reiter zusätzlich durch Linie und Zustand erkennbar. Kontrast und echte Diagrammachsen in S2–S7 prüfen.

Die lokale S1-Kompositionsvorschau unter `design-studies-20261019/s1/` zeigt diese Anordnung und jeden Modulvertrag. Sie enthält keine Messwerte, keinen Suchparser und keine Trackerverbindung. Die bestätigte visuelle Referenz bleibt `design-studies-20261019/dist/` mit Originalhintergrund. Keine vierte Stilvariante. Für S2 Inter wie Referenz prüfen; vorhandene Trackerfonts sind ausschließlich IBM Plex. Eine lokale Inter-Datei ist im geprüften Trackerbestand nicht vorhanden; keine unbemerkte Google-Font-Laufzeitabhängigkeit einbauen. Die bestehende Studie lädt ihre Schrift aus Google Fonts.

## Verbindlicher Kennzahlenkatalog

`R = researchResult(ownedObservations, instruments, request)`, `S = R.selected` vor Pagination. `S_k` ist S gefiltert nach genau einer Messart. Für jede Messart `F_k = fibStats(S_k,k)`, `C_k = F_k.categorical`. API und interne UI verwenden denselben Selektionsweg. Bei `ready=false` keine gültige Statistik/CSV; bei `ready=true` und leerer Auswahl echter Leerzustand. Die bestehende Funktion `fibStats` hat Retracement als Standard: Bei Auswahl beider Messarten ausdrücklich zwei Aufrufe/Ergebnisgruppen, niemals den Standard als Gesamtergebnis ausgeben. R.items ist ausschließlich Tabellenpagination, keine Kennzahlgrundlage.

| ID / Modul | Quelle / konkrete Felder | Bezugsgröße und Ausschlüsse | Darstellung / Grenze |
|---|---|---|---|
| M01 Datenbasis | R.total, S.status; F_k.coverage.total/completed, F_k.running/unclear/invalid | Eindeutiger aktueller Beobachtungsstand; Statuszahlen je Messart, kein Summentopf unterschiedlicher Kennzahl-n | Karten: Auswahl, abgeschlossen, laufend/unklar/ungültig; je Modul eigenes n |
| M02 Schlüsselfibonacci | C_k.keyFibonacci.groups[].distribution.{level,ids,n,share}, groups[].n; excluded | Abgeschlossen, geklärte Messart, explizites keyFibLevel; nach wave/degree/timeframe/measurementKind | Balken Level in %, Anzahl + Anteil; kein Ersatz für End-/Maximallevel |
| M03 Levelerreichung | C_k.levels[].{level,reached,missed,n,share,excluded} | Pro Level eindeutige bekannte erreicht/verfehlt-Fälle; unbekannt außerhalb n; eine Welle darf an mehreren Levels zählen, Zeilen nicht summieren | Beschriftete horizontale Balken für erreicht/verfehlt; Anteil erreicht je eigenem n |
| M04 Umkehrlevel/-bereich | C_k.reversals.groups[].{wave,degree,timeframe,measurementKind,n,distribution}; distribution[].{zone,ids,n,share}; reversals.excluded | Abgeschlossen, Messart geklärt, reversalZone vorhanden; vorhandene Gruppen unverändert | Kategorie-Balken; Punktlevel und Bereiche als verschiedene Beschriftungen; kein Bereichsmittelpunkt |
| M05 Umkehr in erwarteter Zone | C_k.targets[].{wave,degree,timeframe,zone,timing,hit,miss,unknown,n,share} | n=hit+miss, unknown separat; nur bestätigte Endlage; Berührung/Durchlaufen allein kein Treffer; timing trennt rückblickend/vorab/unbekannt | Treffer/verfehlt/unbekannt mit n, Zone und Timing; keine Prognose-/Gewinnquote. Messart über äußeres S_k beschriften (nicht im zurückgegebenen Zielobjekt enthalten) |
| M06 Strukturfamilien/-untertypen | C_k.structureFamilies[].{parent,ids}, C_k.structures[].{code,label,parent,ids}; STRUCTURES | Eindeutige Vereinigung bekannter ids innerhalb einer Ebene als n; F_k.coverage.total minus n separat. Nur zulässige abgeschlossene Fälle; Familien und Untertypen nicht zusammen addieren | Familien-Anteile oder horizontale Balken; Untertypen eigener Abschnitt, keine doppelte ABC-Zählung |
| M07 Welle×Level-Matrix | Für jede feste wave/degree/timeframe-Gruppe categoricalStats(S_k-Gruppe).levels | Zelle n und Anteil wie M03; Spaltenzahlen nicht über Levels aufsummieren. Gruppierung erst S_k teilen, dann vorhandenen Aggregator verwenden | Zelle: erreicht/n und Anteil; leere Grundlage „—“, echte 0 % unterscheidbar. Keine neue serverseitige Matrix nötig |
| M08 Strukturen pro Vergleichsgruppe | categoricalStats(S_k-Gruppe).structureFamilies / structures | Gleiche Gruppierung wie M07, n pro Zeile nur bekannte Strukturen; unbekannte Zahl daneben | Gestapelte Familienanteile, Untertypen separat; kein gemeinsames n verschiedener Gruppen |
| M09 Historische Zeit | S.evidence.historicalTime, periodFrom/periodTo; historicalTime(), boundaryEnvelope(), timeMatch(); R.timeSelection.{basis,selected,denominator,groups} | Wellenzeit statt observedOn; sicher/möglich/unbekannt/ausgeschlossen nach bestehendem Vertrag. Zeitgruppen vor Zeitfilterbasis wie researchTimeGroups; überlappende Jahresgruppen nicht addieren | Chronologische Jahres-/Intervallgruppen mit Genauigkeit. Lücke: fertige Zeitreihenaggregation fehlt, in S7 aus vorhandenen Helfern rein ableiten; keine Jahresmitte erfinden |
| M10 Wellendauer | C_k.durations.groups mit type=wave; distribution[].{bucket,label,ids,n,share}; durations.excluded | Gruppenn, nach wave/degree/timeframe/measurementKind/zone/timeBasis/convention/legacyConvention/unit; unbekannte/fehlende Dauer und nicht abgeschlossene ausgeschlossen gemäß Aggregator | Klassenbalken pro Gruppe; Tage/Stunden und Handels-/Kalenderzeit respektieren; kein Klassenmittel oder globaler Median |
| M11 Umkehrdauer | Wie M10, type=reversal, eigener Zonenbezug | Eigene Teilmenge und Ausschlüsse aus vorhandenem Vertrag | Eigenes Modul; keine Verrechnung mit Wellendauer |
| M12 Zielzonen-Verweildauer | Wie M10, type=residence; F_k.coverage.residenceComparisons.groups[].{zone,timeBasis,convention,unit,n,average,median,included}, excluded | Klassen und exakte kompatible Messungen getrennt. Nicht erreichte Zone, widersprüchliche oder unvollständige Messkonvention ausgeschlossen | Klassenansicht; exakter Mittelwert/Median ausschließlich je bereits kompatibler residenceComparisons-Gruppe |
| M13 Exakte Maximalmessung (Altbestand) | F_k.{n,mean,median,q1,q3,zones}; F_k.coverage.exact.{included,excluded,denominator} | Abgeschlossen, endliche exakte percent mit zulässigem Bereich, Messart geklärt; keine Katalog-/ungefähren Werte | Eigener ergänzender Verteilungsblock. Beschriftung „maximale Messung“, niemals „endgültiges Umkehrlevel“; zones ist numerische Klassierung, keine erwartete Zielzone |
| M14 Datenqualität | Metric-spezifische excluded/unknown und included-IDs aus M01–M13 | Keine allgemeine Qualitätsnote; fehlend nicht gleich null. Gründe und Teilmengen je Kennzahl | Aggregierte Anzahl im Modul, einzelne IDs/Fälle nur hinter bewusst geöffnetem Datengrundlagenzugang |

Für strukturierte Daten ohne Messwert ist M13 nicht anwendbar; das ist kein Fehler der Erhebung. Ein leeres Einzelmodul darf seine fehlende Grundlage erklären, während andere verwendbare Module sichtbar bleiben. Typ-/Statusunsicherheiten nicht durch den Farbton allein transportieren.

## Zustands- und URL-Vertrag für S3/S8

Technische Festlegung für die folgende Umsetzung, in S1 noch nicht implementiert:

- `ResearchView` erhält `perspective: 'panorama' | 'studio' | 'structure'` und `basisOpen: boolean`. URL-Schlüssel `fib.perspective` und `fib.basis=1` (geschlossen: weglassen). Bestehendes `fib.tab` bleibt fachlicher Untertab.
- Beide neuen UI-Schlüssel in `readResearchLocation` auf Duplikate/Werte prüfen und **vor** `readResearchQuery` entfernen. Letzterer lehnt unbekannte Filter ausdrücklich ab. `writeResearchLocation` muss beide UI-Zustände nach dem Entfernen/Neuschreiben der fib.*-Schlüssel wieder schreiben. Sie gelangen nicht als Filter an API/CSV.
- Alte Adressen ohne neue Schlüssel: Panorama, Datengrundlage geschlossen. Expliziter `fib.detail` darf den gewünschten Detailfall öffnen; keine neue automatische Listenöffnung nötig.
- Perspektivwechsel erhält request, Klärungen, Messart und Datenbasis, schließt Datengrundlage der Zielansicht. Für bewusstes Browser-Zurück zwischen Perspektiven `pushState` verwenden; reine vorhandene Filterupdates dürfen ihre bisherige replaceState-Semantik behalten. Hook-Reihenfolge mit Detailhistorie prüfen.
- Filter-/Suchänderung: offset=0, Datengrundlage geschlossen; Perspektive bleibt. Filterreset setzt Auswahl und Klärungen auf bestehende Defaults, behält Perspektive und schließt Datengrundlage.
- Bewusst geöffnete Datengrundlage: URL markiert Öffnung; Detailnavigation erhält Perspektive, Öffnung, Seite, Sortierung, Fokus/Scrollposition. Bereits vorhandenen fibReturnScroll nicht überschreiben.
- Beim Wechsel keine Datenspeicherung, keine neue Brokeraktion und kein eigener zweiter Suchlauf. Alle Perspektiven konsumieren denselben normalisierten Ergebnisstand.
- Lade-/Fehlerzustand erhält Eingaben; veraltete Daten ausdrücklich markieren oder ausblenden. Fehlende Antworten nicht als Trefferzahl 0 ausgeben. Fachlich ungeklärte Suche erklärt den konkreten Konflikt.
- Einzelfall-IDs, Tooltips mit Quellenfällen und Listen aus bisherigen CategoricalResults/Evidence-Komponenten nicht oberhalb des geschlossenen Datengrundlagenzugangs rendern. Auch ein Diagrammklick öffnet keinen Einzelfall ohne bewusste Aktion.

## Konkrete Änderungsflächen ab S2

S2: `app/globals.css` zunächst begrenzt auf neuen Rahmen; `components/cockpit-header.tsx`, `cockpit-nav.tsx`, neue gemeinsame Rahmen-/Hero-Komponente und lokales Referenzasset. Seitenanbieter und getScopeContext erhalten. Bestehendes AppBackdrop darf Referenzhintergrund nicht übermalen; alte Ansichten vor globaler Tokenänderung ansehen.

S3: `fibonacci-panel.tsx`, `fibonacci-location.ts`, `use-fibonacci-location.ts`; eigene Reiterkomponente. S4–S7: gemeinsame Kennzahlmodule aus `researchResult`, `fibonacci-read-model`, `categoricalStats`, `residenceComparisons`; keine zweite Berechnungslogik. S8: Liste, Details und bisherige ergänzende Untertabs hinter bewusster Datengrundlage anbinden.

## Prüfungen, Rücknahme und nächste Session

- Vorhandene reine Regressionen auf der gesicherten Basis: 8 Dateien, 124 Tests bestanden (research, read-model, search, time, categorical, residence, workspace, research-metrics). Keine neuen Tests für Planprosa.
- Bestehende Prüfbefehle: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`; in diesem Worktree auch `node node_modules/vitest/vitest.mjs run …`. Vollbuild in S1 nicht erforderlich: keine App-Quelländerung. DB-Tests verwenden vorhandenes PGlite; keine produktive Datenbank für UI-Tests verwenden.
- Lokale Vorschau: `node scripts/design-contract-preview.mjs` im Trading-Projekt; `http://127.0.0.1:3051/`. Nur feste lokale Referenz-/S1-Dateien, keine Tracker-API, keine Geheimwerte. Sichtprüfung und Ergebnis im Projektbericht.
- Rücknahme S1: Appbasis unverändert; ausschließlich Zielvertrag/Projektbericht/Vorschau ergänzen. Keine Commits oder Pushes automatisch. Eigener Worktree bleibt für S2 erhalten; Vorschauprozess nach Prüfung beenden.
- Nächste Session **S2 – Gemeinsamer Seitenrahmen**: eigenen Worktree und Remote frisch auf fremde Änderungen prüfen, dann Referenzkopf/-hintergrund/-palette mit Navigation und bestehenden Zugängen integrieren. Keine Kennzahlenmodule oder Suchlogik vorziehen. Desktop 1440, 1024 und Mobil 390 prüfen; vorhandene Funktionen erreichbar halten.
- Aufwand nach S1: kein neuer Fachbackendbau nötig; S2–S10 bleiben vorläufig 16–28 aktive Stunden. Zeitaggregation und UI-URL-Erweiterung sind die konkretisierten offenen Ableitungen innerhalb von S3/S7, kein bereits fertiger Code. Die Schätzung bleibt ungemessen und ohne Terminzusage.
