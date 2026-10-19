# Wellenvarianten B und C

Bestätigter Nutzerauftrag: B überschießend, B unterschießend und C truncated als Auswahl ergänzen. Die vorhandene Auswahl Welle enthält alle drei Varianten im Formular und im Filter.

## Datenvertrag

Grundwelle bleibt B beziehungsweise C, optionale ausdrückliche Kennzeichnung unter `evidence.waveVariant`: `b_overshooting`, `b_undershooting`, `c_truncated`. Keine Ableitung aus Kurswerten, Fibonacci-Level oder Flat-Struktur. Fehlend/null bedeutet nicht erhoben. Grundwelle und Kennzeichnung müssen zusammenpassen. Allgemeiner B-/C-Filter enthält alle entsprechenden Varianten; ein Variantenfilter selektiert die Untermenge. Unterwellenumfang bezieht sich auf die passenden Elternwellen. Bestehende Daten werden nicht geändert; keine SQL-Migration erforderlich.

Auswertung: eigene Häufigkeiten getrennt nach Grundwelle, Wellengrad, Timeframe und Messart; Nenner der Anteile sind abgeschlossene, eindeutig erfasste Varianten. Alle übrigen Fälle mit IDs und Ausschlussgrund sichtbar. Keine fehlende Angabe als unterschießend oder regulär einstufen. Detailansicht, URL-Zustand, API-Suchgrammatik, CSV und Revisionsschutz berücksichtigen die Kennzeichnung. Ältere Clients erhalten beim Bearbeiten eine zuvor gesetzte Kennzeichnung; bewusste Löschung über null.

## Prüfung und Rücknahme

Synthetische Unit-/API-/DB-Prüfungen umfassen alle drei Varianten, unbekannte Codes, falsche Grundwellen, Altclient-Erhalt, explizite Korrektur/Löschung, Eigentümergrenzen, Revisionen, CSV, URL und Unterwellen. Sichtprüfung mit lokalem PGlite-Konto; produktiv ausschließlich lesen. Nur diese Änderung nach Prüfung neuerer Arbeit rücknehmen; bereits erfasste Varianten bleiben im Evidence-JSON erhalten.
