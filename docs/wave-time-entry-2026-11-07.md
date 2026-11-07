# Wellenzeit vereinfacht - 07.11.2026

Auftrag: Tageszahl direkt erfassen, automatisch in die bestehenden Dauerklassen einsortieren; Zeitpunkt nur mit Monat und Jahr eingeben. Main-Push ausdruecklich beauftragt. Nutzer verzichtet auf ausfuehrliche Pruefung.

Umsetzung: Wellendauer in Kalendertagen, auch Dezimalwerte. Bestehende halboffene Klassen unveraendert (Untergrenze eingeschlossen, Obergrenze ausgeschlossen); 15 Tage ergeben 7-30 Tage. Exakte Tagesangaben werden in der Auswertung bevorzugt, alte Klassen bleiben Rueckfall. Monatsfeld erfasst den Wellenbeginn mit Monatsgenauigkeit, ohne erfundenen Tag oder Enddatum. Zeitverteilung unterscheidet Monate und Jahre. Alte Datumsgenauigkeit, Grenzen und Zielzonenangaben bleiben im aufklappbaren Bestandseditor erhalten. Keine Datenmigration und keine produktiven Testeintraege.

Pruefung: TypeScript und Git-Diff-Pruefung; keine Browserabnahme, kein Build und keine umfangreiche Testsuite auf ausdruecklichen Wunsch des Nutzers.
