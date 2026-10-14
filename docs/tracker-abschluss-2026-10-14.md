# Trackerintegration vom 14.10.2026

Basis: veröffentlichter Stand 754eae8. Bestätigter Auftrag: ältere noch offene Trackerreparaturen abgleichen, integrieren, prüfen und veröffentlichen. Keine Handelsregel-, Kosten-, Schema- oder Brokeränderung.

## Altbestand und Übernahme

- Schnelle Tradeanlage 6915d71, Symbol-/Kursreparatur bdc1b81, Editorreparatur 085cbaa, Gewinnvorschau 8bcf9d8, UTC-Diagnose a981017 und FX-/Alarmreparatur 754eae8 sind bereits in origin/main enthalten.
- Älterer Integrationsbranch 571bcce ist veröffentlicht, jedoch nicht als Ganzes in main enthalten. Seine Instrument-, Such-, Kursalter- und Frühvalidierungsreparaturen wurden bereits durch spätere Commits übernommen. Dateivergleich bestätigt identische Fassungen der entsprechenden zwölf Code-/Testdateien; neuere Unterschiede in symbols/resolve erhalten insbesondere Anbieterbindung und echte Spotquelle.
- Noch fehlende Versionsbindung des Aktivierungsdialogs übernommen: Öffnungsfassung bleibt bei einem Refresh festgehalten; veraltete Aktivierung wird vor fachlichem Schreiben abgewiesen. Der bestehende manuelle Abgleich prüft die Ausgangsversion und reicht seine geschützte aktuelle Version nach rein technischen Cursoränderungen weiter.
- Drei vorhandene PostgreSQL-Regressionen übernommen: veralteter Dialog ohne Schreiben, vollständiger aktueller Plan ohne zusätzliche historische Zustimmung, unvollständiger Plan trotz altem Ja-Flag abgewiesen. Zwei Action-Regressionsfälle prüfen Versionsweitergabe und Nichtausführung bei Konflikt.
- Historische Variante 52ec4df und uncommittierter Session-2-Ursprung bleiben erhalten. Historische Freigabe-/Archivvarianten ersetzen nicht die bestätigten neueren Handelsbedingungen. Archivveröffentlichung wird separat dokumentiert.

## Prüfungen

89 Testdateien / 1.343 Tests bestanden, 15 Sekunden Testlimit und zwei Worker. Separate Typprüfung bestanden. Lokaler Build und Veröffentlichungsnachweis werden nach Abschluss ergänzt. Keine persönlichen Schreibtests. Build ohne produktive Auth-/DB-Zugangsdaten; entsprechende lokale Authhinweise beweisen keine Produktionsstörung.

Öffentlicher Assistenten-API-Vertrag bleibt erhalten. Interne Aktivierungsoption ergänzt optional expectedVersion; die UI nutzt sie bei jeder Aktivierung. Kein Datenbankschema geändert.
