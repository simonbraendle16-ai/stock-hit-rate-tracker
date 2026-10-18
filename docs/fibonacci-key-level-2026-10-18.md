# Schlüsselfibonacci

Bestätigter Auftrag vom 18.10.2026: Ein entscheidendes tatsächlich angelaufenes Fibonacci-Level unabhängig von erwarteter Zielzone und beobachtetem Umkehrbereich erfassen und auswerten. Anschließend auf main pushen.

- Optionales `evidence.keyFibLevel: number | null` aus dem bestehenden Levelkatalog, direkt sichtbar in „3 · Tatsächliche Beobachtung“. `null` entfernt den Wert ausdrücklich; fehlendes Feld bei älteren PATCH-Clients erhält den bisherigen Wert. Keine Migration oder automatische Bestandsnachpflege.
- Zielzone 50–78,6 %, Schlüsselfibonacci 61,8 %, Umkehr zwischen 61,8 und 78,6 % bleiben drei eigene Angaben. Daraus entsteht keine exakte maximale Prozentmessung.
- Validierung gegen unbekannte Katalogwerte, verfehlte Levels, unerreichte Zielzone, Umkehr-Obergrenze und vorhandene exakte Messung. Fehlende Angaben werden nicht abgeleitet.
- Protokoll zeigt das Schlüsselfibonacci auf Desktop/Mobil; vollständige Evidence im CSV. `stats.categorical.keyFibonacci` enthält Verteilungen je Welle, Wellengrad, Timeframe und Messart, Fall-IDs, bekannte Nenner und begründete Ausschlüsse. Nur abgeschlossene Fälle mit geklärter Messart zählen; pro Welle die jüngste Revision. Das Schlüsselfibonacci zählt zusätzlich als ausdrücklich erreichtes Level in der kategorialen Levelhäufigkeit, niemals als punktgenaue Umkehr.
- Synthetische Tests: ursprünglicher Fall, unbekannter/fehlender Wert, 0 %, ungültige Werte, Widersprüche, API-POST/GET, identischer Retry, Erhalt und ausdrückliches Löschen durch PATCH. Persönliche Beobachtungen werden durch diese Implementierung nicht angelegt oder geändert.

Prüfergebnis: 71 betroffene Tests bestanden (45 Logik-/Lesemodelltests, 26 API-/PGlite-Tests), unabhängige Typprüfung und Webpack-Produktionsbuild bestanden. Lokaler Browser zeigt das sichtbare Feld und die gewählte 61,8-%-Option; Screenshot im Begleitprojekt. Testformular abgebrochen, eigene Vorschau und Browser beendet. Keine vollständige Mobilabnahme. Das PGlite-Startlimit wurde von 30 auf 120 Sekunden erhöht; unveränderte Prüfungen liefen anschließend erfolgreich. Turbopack konnte die verknüpften Worktree-Abhängigkeiten nicht auflösen; Webpack erfolgreich. Build ohne produktive Auth-Umgebung meldet entsprechende Better-Auth-Hinweise; keine Geheimwerte geladen oder geändert.

Rücknahme: ausschließlich diese Ergänzung gezielt revertieren; bereits gespeicherte JSONB-Daten erhalten. Ältere Writer kennen das neue Feld nicht; vor einem Rollback deren Validierungsvertrag prüfen.
