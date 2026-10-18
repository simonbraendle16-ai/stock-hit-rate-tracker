# Geführte Datumseingabe der Wellensammlung

Nutzerauftrag vom 18.10.2026: Die ausfüllbare Datumsvorlage für historischen Beginn und historisches Ende wiederherstellen und unmittelbar pushen.

Ursache: Die Erweiterung auf historische Tages-, Monats- und Jahresangaben verwendete ein gemeinsames Freitextfeld. Wiederhergestellt sind native Datumsfelder mit segmentierter Eingabe, im geprüften deutschen Edge `TT.mm.jjjj`, einschließlich Kalender. Standard ist Tag; Monat und Jahr bleiben ausdrücklich wählbar. Ein Wechsel des Formats leert nur die betreffende Grenze und weist auf die erneute Eingabe hin. Keine künstlichen Tagesangaben für reine Monats-/Jahresbeobachtungen; bestehende gespeicherte Genauigkeit bleibt beim Öffnen erhalten. Speicherung, API und Datenbank unverändert.

Prüfung: TypeScript ohne Fehler; bestehende Datumstests 8/8 bestanden; Git-Diff ohne Whitespacefehler. Echte lokale Next.js-Instanz mit isolierter synthetischer PGlite-Datenbank und Testkonto: Vorlage beider Grenzen in Edge sichtbar, native Datumseingabe per Tastatur und Erhalt nach weiterer Formularinteraktion geprüft. Monatsformat mit nativem Monatsfeld und Jahresformat mit JJJJ-Eingabe geprüft. Keine persönlichen Daten oder Produktionsdatensätze verändert. Browser-Fill allein lieferte bei nativen Kalenderfeldern keinen belastbaren React-Zustandsnachweis; deshalb Tastatureingabe zusätzlich geprüft.

Rücknahme: ausschließlich Komponentenänderung dieses Commits zurücknehmen; keine Migration erforderlich.
