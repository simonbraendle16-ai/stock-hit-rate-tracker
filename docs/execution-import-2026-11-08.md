# Broker-Ausführungen ohne ursprünglichen Plan

`POST /api/assistant/v1/trades/import` benötigt das bestehende Recht `trades:write`.
Der eigenständige Importvertrag akzeptiert aktuell Match-Trader-Ausführungen in
einem eigenen, nicht archivierten USD-Demodepot. Normale Plananlage und deren
Pflichtfelder bleiben unverändert.

Der Request enthält `portfolioId`, `ticker`, `market`, `direction`, `capturedAt`
und den vollständigen `execution`-Beleg gemäß `lib/execution-import.ts`. Eröffnung,
Abschluss, Lots, Brutto, Netto, signierte Provision/Swap und Quellidentität werden
unverändert als Brokerbeleg in `externalSource.execution` gespeichert. Originaler
Stop, Ziel, Stückzahl, Plan-FX, subjektive Bewertungen und Anfangsrisiko bleiben
unbekannt. Beobachtete letzte Stop-/Zielwerte sind im Beleg getrennt abgelegt.
Offene Positionen haben kein realisiertes Ergebnis. Pending-Orders werden nicht
als Ausführungen importiert.

Konto-Fingerabdruck und Positions-ID bilden eine besitzergebundene dauerhafte
Identität. Gleicher Inhalt mit neuer Beobachtungszeit liefert denselben Trade.
Abweichender Inhalt derselben Position wird mit 409 abgewiesen, damit weder
Korrekturen noch spätere Abschlüsse unbemerkt neue Trades erzeugen. Teilabschlüsse
derselben Position müssen vor einem künftigen Import fachlich gruppiert werden;
dieser erste Vertrag nimmt nur vollständige Einzelpositionen auf.

Migration 0061 erlaubt echte NULL-Planwerte ausschließlich bei aktiven oder
abgeschlossenen Importen. Der dedizierte Runner
`scripts/apply-execution-import-migration.mjs` benötigt eine explizite direkte
Verbindung und `--apply`, sperrt die Tabelle kurz und prüft vor/nachher denselben
Bestandsfingerprint. Die historische Sammelmigration mit erneuter Ausführung
von 0032 darf nach echten NULL-Importen nicht verwendet werden; spätere Änderungen
gezielt migrieren. Rücknahme vor dem ersten Import: neuen Constraint entfernen
und beide NOT-NULL-Vorgaben wiederherstellen. Nach Importen zuerst deren Erhalt
sichern; kein automatisches Löschen oder Auffüllen fehlender Planwerte.

Netto-/Bruttoauswertungen lesen den Brokerbeleg direkt. R/CRV bleiben mangels
Anfangsplan unbekannt, und monetäre Equity-Auswahl benötigt kein bekanntes R.
Importe werden weder durch den Stundenzyklus noch den alten Demo-Simulator
fortgeschrieben. Die Karten und Detailseite zeigen Ausführung und Ausgang;
manuelle Plan-/Ausführungsänderungen über den normalen Planweg sind gesperrt.

Geprüft: isoliertes PostgreSQL via PGlite mit Migration zweimal, unverändertem
Altbestand, SQL-Pflichtfeldern normaler Pläne, exakten Ergebnissen, offenem Fall,
Idempotenz/Konflikt, Eigentümer-/Depotgrenzen, Ausschluss aus Simulation/R und
echtem API-Token-Lese-/Schreibrecht. Dazu vorhandene Statistik-, Ereignis-,
Plan-/Mutations- und Demo-Regressionsgruppen, separate Typprüfung und Next-Build.
