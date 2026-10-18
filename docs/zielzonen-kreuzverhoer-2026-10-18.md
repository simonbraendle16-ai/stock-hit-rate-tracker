# Kreuzverhör vor dem beauftragten Push – 18.10.2026

Auftrag: bisherige lokale Zielzonen-Umsetzung erneut mit `kreuzverhoer` hinterfragen, belegte Schwächen beheben und anschließend pushen. Ausgang `8419200`, Feature-Branch `feat/target-zone-residence-20261018`. GitHub `main` vor dem Push rein lesend auf `9d987697128eb1cb61a8f485ca0e6ee7db0227f1` geprüft; entspricht der lokalen Ausgangsbasis. Kein fremder Branch wird überschrieben.

**Urteil:** nach einem zusätzlichen Löschschutz für den Feature-Branch ausreichend abgesichert. Die Klassifikation und Zeitgenauigkeit bleiben getrennt. Ein Push des Feature-Branches ist keine bestätigte produktive Verfügbarkeit und keine persönliche Datenmigration.

## Tragende Fragen und Belege

1. **Kann ein alter Eingabeweg neue Daten unbemerkt löschen?** Belegter Fehler vor Korrektur: `saveFib` schützt fehlende Evidence und ältere Evidence-Objekte ohne neuen Schlüssel, akzeptierte aber `evidence:null` und hätte damit die neue Verweildauer gelöscht. Korrektur: ist bereits eine Verweildauer gespeichert, wird dieses pauschale Löschen mit HTTP 422 und konkreter Anleitung abgelehnt. Gezielt entfernen weiterhin über `evidence.targetZoneResidence:null`. API-Test bestätigt Ablehnung, unveränderte Version/Daten, und danach erfolgreiche gezielte Entfernung. Gegenfall ohne Verweildauer darf alte Evidence weiterhin mit `null` löschen. Keine pauschale Änderung des Altvertrags.
2. **Schleichen sich erfundene Dauern in Statistik oder Export?** Vertrag und Tests behalten strikte Obergrenze ohne Punktwert, berichtete acht Stunden, ungefähre Werte, Bereich und unbekannt separat. `touchAndGo` ist ausdrücklich dreiwertig; unbekannt zählt nicht als Nein. Kalender-/Handelszeit, Einheiten und offene Messkonvention geprüft; keine Annahme einer 24-stündigen Handelszeit. CSV-JSON-Rundlauf erhält Grenzen, Originaltext und ID. Vorhandene Wellen-/Umkehrdauer wird nicht kopiert.
3. **Ist „exakt berichtet“ mit einer unabhängig gemessenen Dauer verwechselt?** Nein. Offene Zeitbasis/Messweise schließt auch exakt berichtete Zahlen aus vergleichbaren Mittelwerten aus. Keine automatischen Episoden, keine automatische Chartmessung. Diese Grenze bleibt ausdrücklich dokumentiert; eine neue Nutzerfrage ist für den verlustfreien Erfassungsvertrag nicht nötig.
4. **Beweisen lokale Tests die produktive Funktion?** Nein. Nur der aktualisierte Server kennt neue Evidence und Löschschutz. Ein Rollback auf einen älteren Writer ist nicht automatisch sicher; gespeicherte JSONB-Angaben/Revisionen müssen erhalten bleiben und Writer vor produktiver Freigabe geprüft werden. Der jetzige Auftrag autorisiert Push; dieser Schritt verändert `main` nicht.
5. **Wird beim Push mehr übertragen als das geprüfte Feature?** Geprüfte Ausgangsbasis entspricht Remote-main. Feature umfasst Datenvertrag, Service/Tests, bestehende UI-/Statistik-Erweiterungen, lokale synthetische Nachweise und Dokumentation. Keine Umgebungsdateien, Prüftoken oder persönlichen Trade-/Brokerdatensätze in den neuen Dateien. Keine neue SQL-Migration, Hintergrundautomation oder Brokeraktion.

## Prüfung nach der Korrektur

- Fibonacci-Regression: **6 Dateien / 77 Tests bestanden**. Der HTTP-Fall prüft die neue Ablehnung einschließlich unveränderter Version, der eigene Gegenfall den weiterhin zulässigen alten Null-Reset.
- Separate Typprüfung und `git diff --check`: bestanden.
- Vorherige Desktop-/Mobil-/Browser→API→DB-Abnahme und Build bleiben Ereignisnachweise. Die jetzige Änderung betrifft ausschließlich den serverseitigen Null-Löschpfad und ist durch den isolierten API-/DB-Test geprüft; kein erneuter UI-Umbau, Neustart oder persönlicher Schreibtest.
- Erhalt des neuen Objekts bei fehlendem Schlüssel, gezieltes Löschen, Retry, Revisionsabruf und Versionskonflikt sind weiterhin in den 77 Tests enthalten.

Keine offene Rückfrage für den Branch-Push. Offen bleiben spätere Integration/Produktivabnahme, persönliche Nachpflege und echter Voice-Test. Bei neuen Datenverlustbelegen oder geänderter Remote-Basis vor Integration erneut prüfen; kein Force-Push.
