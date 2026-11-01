# Sichtbarer Gesamtbestand · 01.11.2026

Datensammlung und Wellenstatistik zeigen oberhalb der Suche den vollständigen geladenen Bestand mit Aufteilung nach Retracements und Expansionen. Die Anzeige bleibt unabhängig von Suche und Filtern. Die bisherige untere Bestandsanzeige bezeichnet jetzt ausdrücklich die gefilterte Anzahl und Messart. Statistische Nenner, API und Datenbank bleiben unverändert.

Prüfung: separate Typprüfung und Produktionsbuild bestanden; vorhandene Regressionen für Workspace und Read Model 12/12 bestanden. Isolierter Edge-Browser am Produktionsbuild mit synthetischer PGlite-Datenbank: beide Seiten bei 1440/390 px, Zähler ohne Überlauf, Messartwechsel ohne Änderung des Gesamtbestands, neue Expansion von 24/24/0 auf 25/24/1 nach bestätigtem Speichern ohne manuelles Neuladen und leerer Bestand bestanden. Keine Seitenfehler. Screenshots tatsächlich gelesen. Maschineller Nachweis: wave-counter-qa/result.json. Keine persönlichen Testeinträge.

Die ursprüngliche 85 entsprach exakt der Zahl der Retracements bei 128 Gesamtbeobachtungen (43 Expansionen). Nutzer bestätigte die Verwechslung. Keine vollständige Datenverlustprüfung behauptet; die drei fraglichen Wellen wurden nicht einzeln identifiziert. Kaltstarts der Dev-Vorschau überschritten Prüfzeitlimits; finaler Lauf am gebauten Produktionsstand erfolgreich.
