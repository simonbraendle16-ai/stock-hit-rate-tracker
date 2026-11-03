# Marktdatenziel und Migrationsvorbereitung · Phase 3

Nur lokale Implementierung und synthetische Abnahme. Keine Veröffentlichung,
produktive Konfigurationsänderung, Cloudanlage oder produktive Kopie.

## Verantwortungsorte und Konfiguration

A bleibt persönlicher Kern: Auth, Instrumente, Depots, Trades/Ereignisse/Orders,
Abrechnung, Wellen/Revisionen/Elternbezüge, persönliche Historiensnapshots und
Trainerdaten. Kurs-/FX-Snapshots, aktive Trade-Bedarfsprüfung, Stundenclaim und
sämtliche automatischen Anbieterbudgets/-leases bleiben ausschließlich A.

`lib/market-data/location.mjs` ist die gemeinsame Zuordnung für App und Wartung.
Die App liest sie einmal je Modulinstanz aus serverseitigen Umgebungswerten.

| Einstellung | Verhalten |
|---|---|
| Keine neuen Werte | `legacy`, A, bisheriger Betrieb; keine Aktivierung durch Code allein |
| `MARKET_DATA_ROUTING_VERSION=1`, `MARKET_DATA_LOCATION=A` | Bewusste versionierte Rückkehr nach A |
| `MARKET_DATA_ROUTING_VERSION=1`, `MARKET_DATA_LOCATION=B` | Alle drei Markttabellen über `MARKET_DATABASE_URL` nach B |
| Unbekannte Version/Ziel oder fehlendes B | Fehler; niemals stiller Rückfall auf A |

Die Version 1 ist eine vollständige stabile Paketzuordnung aller Symbole nach B,
keine gewichtete 50/50-Verteilung. Beides sind getrennte Ziele. Symbol-/Intervall-
und Providersemantik bleiben unverändert. URLs nie an Browser, Logs oder Status
weitergeben; niemals `NEXT_PUBLIC_` verwenden. Bestehende `.env`-Dateien sind in
Phase 3 unverändert. Normale Appverbindungen gepoolt, Migrationen über dedizierte
direkte Verbindungen. Approllen später ohne DDL-/Trigger-/Kontrolltabellenrechte
einrichten; diese Produktionsrechte wurden hier nicht eingerichtet/abgenommen.

A-Pool maximal 10 Verbindungen je Instanz, B maximal 3, B-Verbindungswartezeit
2 Sekunden, Statementlimit 4 Sekunden, Clientlimit 5 Sekunden, Idle-Transaktion
5 Sekunden. Das sind Instanzgrenzen, keine globale Anbieter-Verbindungsgarantie.
Kein unbeschränktes automatisches Retry. Ein späterer expliziter Abruf kann nach
Wiederkehr neu versuchen. Idle-Verbindungsfehler beenden den Prozess nicht;
fehlgeschlagene Abfragen bleiben Fehler. `marketDatabaseStatus()` liefert nur
bereinigte Konfiguration/Poolzahlen und einen seit Initialisierung beobachteten
Poolfehler, keinen bestätigten Live-Healthcheck oder Frischebeleg.

## Zugriff und Transaktionsgrenze

`database.ts` verwendet für B einen eigenen Drizzle-Pool ohne den persönlichen
AsyncLocalStorage-Transaktionskontext. candle-store, Sammler-Reihen/Laufprotokoll,
Demo-Reihenmetadaten, private Snapshotquelle und Reparaturkerzen nutzen ihn.
Persönliche Transaktionen bleiben A. Historische Quellen werden vollständig
begrenzt aus B gelesen, dann in A als persönliche unveränderliche Kopie gesichert.

Demo-Buchungen bleiben atomar in A; ihre B-Lesungen sind eigenständige,
zeitbegrenzte Abfragen. Kein über A/B atomarer Snapshot. Ein B-Fehler liefert
keinen erfolgreichen Prüf-/Buchungsbeleg. Bereits gespeicherte persönliche
Historiensnapshots benötigen B zum Lesen nicht. Trainer bleibt deaktiviert;
seine Kerzenverbraucher und reine Rechenlogik bleiben erhalten. Keine neue
Alarm-, Demo-, Broker-, Wellen-/Statistik- oder geplante-Trade-Automatik.

Wartung verwendet `scripts/market-client.mjs`: persönliche Bedarfsdaten aus A,
Markttabellen aus demselben gewählten Ziel wie die App. Gemischtes SQL wird
abgewiesen; der Audit-Join ist in zwei Lesungen aufgelöst. BEGIN/COMMIT im
Wartungsclient schützt nur Marktoperationen. Keine gemeinsame Lesesicht mit A.
Retention/Prüfung/Repair sind vorhandene explizite Werkzeuge, keine neuen Jobs.

## Getrennte Schemaverwaltung

Nur `drizzle-market/0001_market.sql` und `0002_control.sql` in B ausführen.
0001 enthält candle_cache, candle_series mit executionSession und
candle_collect_run samt Primärschlüsseln, Defaults, Indizes und serial-Sequenz.
0002 enthält ausschließlich die betriebliche Kontrolle/Paketprüfsummen und
Schreibschutztrigger. Keine vollständigen persönlichen Drizzle-Migrationen in B.

Die separate `drizzle-market-core/0001_control.sql` installiert dieselbe Kontrolle
auf den vorhandenen drei Quelltabellen in A, ohne persönliche Tabellenänderung.
Alle Dateien sind idempotent und wurden isoliert erneut ausgeführt.
Nichts davon wird beim Appstart oder Build automatisch angewandt. Das lokale
CLI führt die Dateien ausdrücklich und in Reihenfolge aus; ein Fehler beendet
den Aufruf. Wiederholung der idempotenten Dateien ist möglich.

## Vorbereiteter Cutover und Rückweg

1. In einer später autorisierten Phase Backup/Restore, reale Quell-/Zielidentität,
   Rechte, Limits und freien Transferpuffer prüfen. Noch kein Phase-3-Nachweis.
2. Schutzmigration auf A und Marktschema/Schutz auf B installieren. Trigger
   erfassen auch alte Appreleases und direkte INSERT/UPDATE/DELETE/TRUNCATE.
3. `setMarketWritable(A,false)` und dann B sperren. Exklusive Transaktionssperre
   wartet auf laufende Schreiber; Trigger nehmen geteilte Transaktionssperren.
   Persönliche Tabellen sind davon nicht betroffen. Anbieterabrufe können noch
   laufen, aber ihre folgenden DB-Schreibvorgänge werden abgewiesen. Alte
   Releases stoppen/drainen, bevor ein Ziel wieder freigegeben wird.
4. `copyMarketPackages(A,B,id)` über getrennte dedizierte Direct-Clients.
   Exklusive Sessionlocks auf beiden Seiten verhindern parallele Kopie,
   Rücknahme und Freigabe bis zur letzten Prüfung. Bei Konkurrenz fail-fast,
   kein Warten mit gegenseitig gehaltenen Locks. Nicht über PgBouncer nutzen.
5. Symbole samt allen Intervallen und Metadaten werden paketweise in einer
   Zieltransaktion ersetzt. SQL-Keyset-Seiten maximal 500 Zeilen; Symbolinventar
   in 100er-Seiten. Protokolle als eigenes Paket. Keine Quelle löschen.
   SHA-256 über kanonischen Inhalt und Zeilenanzahl vor/nach jedem Paket.
   Checkpoint im selben Zielcommit. Abbruch innerhalb des Pakets rollt es zurück;
   bereits abgeschlossene Pakete werden mit erneutem Inhaltsabgleich fortgesetzt.
   Beschädigtes Zielpaket wird neu kopiert. Kontrollgenerationen binden den Lauf.
6. Sequenz auf mindestens Quell-/Zielsequenzstand und größte ID setzen; verbrauchte
   Nummern/längere Sequenzlücken bleiben erhalten. Beide Marktziele bleiben nach
   Kopie gesperrt. Keine automatische Appkonfigurationsänderung/Freigabe.
7. Erst später nach vollständiger Bestandsprüfung die gesamte App/Jobs/Wartung
   einheitlich mit Version 1 nach B schalten und B freigeben. A gesperrt halten.
   Funktions-/Betriebsnachweis erbringen, alte Schreiber weiter abweisen.
8. Rücknahme: B sperren/drainen, **aktuelles B nach A zurückkopieren**, mit neuer
   Rücknahmekennung. Vereinigung der Symbole beider Seiten ersetzt auch Ziel-
   Löschungen, neue Symbole, korrigierte Kurse, Metadaten und Laufprotokolle.
   Erst nach Abgleich alle Verbraucher nach A stellen und A freigeben; B bleibt
   gesperrt. Keine bloße Umgebungsrückstellung auf veraltete A-Daten.

`tracker.market_migration=on` ist nur der explizite transaktionslokale Bypass des
privilegierten Kopierwerkzeugs. App-/Wartungspfade setzen ihn nie. Er ersetzt keine
Anbieter-/Rollenabsicherung. Eine verlorene Migrationsverbindung verliert ihren
Sessionlock; beide persistenten Schreibsperren bleiben geschlossen. Bei einem
unbekannten Commitausgang erst Prüfsummen/Checkpoint lesen, nicht freigeben.

Lokales CLI (enthält absichtlich keine produktive Freigabe):

```text
ISOLATED_CORE_DATABASE_URL=<lokale synthetische Quelle>
ISOLATED_MARKET_DATABASE_URL=<lokales synthetisches Ziel>
node scripts/prepare-market-migration.mjs schema --id=probe
node scripts/prepare-market-migration.mjs copy --id=probe
node scripts/prepare-market-migration.mjs resume --id=probe
node scripts/prepare-market-migration.mjs rollback --id=probe
```

CLI akzeptiert ausschließlich Loopback-Postgresziele und liest keine .env-Datei.
Die wiederverwendbaren Migrationsfunktionen sind von der Produktion unabhängig;
ihre Verwendung gegen reale Ziele benötigt erst Phase 4 und deren Kontrollen.

## Messgrenzen

Normale gespeicherte Kerzen: eine begrenzte SQL-Lesung; warme Schlusskurse: eine
schmale Metadatenlesung plus begrenzte Close-Lesung. Keine zusätzliche A-Abfrage
zur Ortsauflösung. Migrationskopie benötigt Quellenprüfung **und** Kopierlesung
sowie Zielprüfung; Resume liest zur Prüfung beide Seiten. Bericht nennt getrennt
Kopierpayload und Quell-/Ziel-Prüfpayload als JSON-Byteschätzungen, keine gemessenen
Neon-Wirebytes. Paketjournal/Schutztrigger und zweite Verbindung haben zusätzlichen
Aufwand. Keine Transferersparnis-, Monatsverfügbarkeits- oder 50/50-Zusage aus
isolierten Fixtures.
