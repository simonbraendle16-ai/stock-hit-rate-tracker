# FX-Vorschau und automatische Kursalarme

Ausgangsbasis `a981017`, 13.10.2026. Nutzer hat Umsetzung, abschließende Validierungsschleife und Veröffentlichung beauftragt.

## Verhalten

Neue Trade-Pläne beziehen automatische kostenlose EZB-Referenzkurse. Ein einstündiger persistenter Cache und prozessinterne Abrufbündelung schonen die Quelle. Referenzdatum, Abrufzeit und Herkunft bleiben getrennt; gültiger Ersatzbestand wird bei Ausfall ausdrücklich markiert. Die bestehende Sieben-Tage-Grenze bleibt bestehen. Manuelle Ersatzkurse benötigen das tatsächliche Referenzdatum.

Die Vorschau bekommt einen serverseitigen Snapshot, gebunden an Eigentümer, Depot und Währungspaar. Neuanlage und Kontraktdeckung verwenden exakt diesen Snapshot, dessen Kennung am Trade erhalten bleibt. Historische Kurse und Ergebnisse werden nicht neu bewertet. Formularwerte bleiben bei Fehlern erhalten; verspätete Abrufe werden verworfen und ohne gültige Berechnung bleibt Speichern gesperrt.

Die Alarmroute verwendet ausschließlich `ALERT_CRON_SECRET`. Der allgemeine Cron-Schlüssel berechtigt sie nicht mehr. Automatische Alarmprüfungen laufen in begrenzten Batches mit persistenter Fortsetzung und gemeinsamer DB-Lease für Browser-/Cronaufrufe. Unaufgelöste Instrumente, Näherungsquellen und ungültige/veraltete Kurswerte zählen nicht als geprüfte Alarme. Nur ein vollständig erfolgreicher automatischer Durchgang gilt als gesund.

E-Mail-Wiederholungen verwenden einen gespeicherten Umschlag und denselben AgentMail-Idempotenzschlüssel. Aktuelle Versandpräferenzen und Empfänger werden erneut geprüft. Nach Ablauf des sicheren Wiederholungsfensters bleiben unklare Zustellungen zur Prüfung gesperrt. Ein ausgefallener Mailer blockiert weitere Kursprüfungen nicht.

## Verträge und Betrieb

- Additive Migration: `drizzle/0052_fx_and_alert_health.sql`. Vor Deployment mit explizitem direktem Zielzugang über `scripts/apply-fx-alert-migration.mjs --apply` ausführen. Standardaufruf ist Dry-run ohne Verbindung. Das Skript prüft Schema und unveränderte Bestandsfingerabdrücke.
- Server Action `getTradePlanFx`: serialisierbares Erfolg-/Fehlerergebnis. Interne Neuanlage ergänzt optional `fxSnapshotId`; der bisherige Assistenten-API-Eingabevertrag bleibt erhalten.
- `updatePortfolioFxRates` verlangt bei nichtleeren Kursen zusätzlich `referenceAt`. Bestehende Formulare wurden angepasst. `useAutomaticPortfolioFx` wählt ausdrücklich automatische Kurse.
- Alarmroute: 200 vollständiger Erfolg, 202 fortsetzbare Restarbeit, 409 Überschneidung, 503 Fehler/Teilfehler. Plattformlimit 25 Sekunden, Arbeitsbudget darunter. Fehlendes eigenes Geheimnis ergibt 500, falsche Authentifizierung 401.
- Vorgesehener Zeitgeber: cron-job.org alle fünf Minuten, Alarm-Geheimnis im Authorization-Header, Fehler-/Erholungsmeldungen nur an bestehenden Betreiberkontakt. GitHub-Alarmworkflow bleibt deaktiviert; Demo-Workflow bleibt getrennt. Keine Antwortinhalte beim Zeitgeber speichern.

## Validierung

89 Testdateien / 1.338 Tests bestanden. Separate Typprüfung, Diffprüfung und finaler `next build --webpack` bestanden. Der Build überspringt selbst Typfehler; deshalb die separate Typprüfung. Lokaler finaler Build verwendet ausschließlich eine isolierte Auth-Konfiguration ohne Produktionszugang.

PostgreSQL/PGlite prüft additive und wiederholbare Migration, unveränderten Altbestand, Vorschau-/Speichersnapshot, Eigentümer-/Depot-/Währungsbindung, Ausfälle und Zeitgrenzen, Cursorfortsetzung, Überschneidung, Quellenfehler, HTTP-Vertrag, Versandwiederholung und Empfänger-/Präferenzwechsel. Echte Browserprüfung mit isolierten Actions bestätigt Vorschau, Eingabeerhalt, Fehlermeldung, Speichersperre, Rücksetzen der Risikobestätigung und Depotwechsel. Keine persönlichen Testtrades und kein echter Testversand aus den isolierten Prüfungen.

Offizieller EZB-Feed zusätzlich frisch lesend geprüft: HTTP 200, Referenzdatum 13.10.2026, 29 Währungen.

## Rollout und Rücknahme

Eigener geschützter Alarm-Schlüssel im bestehenden Vercel-Projekt vorbereitet. cron-job.org-Job 8639967 gespeichert, zunächst deaktiviert bis zur geprüften Produktivschaltung und konkreten Berechtigungsbestätigung. Automatische Nachweise und 24-Stunden-Betriebsabnahme sind getrennt von Code-/Buildprüfungen; keine unbegrenzte Verfügbarkeitsgarantie.

Rücknahme: Alarmjob zuerst deaktivieren und ausschließlich Reparaturcommit gezielt zurücknehmen. Additive Tabellen/Spalten und historische Snapshots zunächst erhalten. Kein pauschaler Reset, kein neues Upgrade, keine Broker-/Handelsregeländerung. Ausführlicher fortgeschriebener Betriebsnachweis im Trading-Assistenten: `06_Integrationen/Tracker-FX-und-Alarm-Reparatur-2026-10-13.md`.

Quellen: [EZB](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html), [cron-job.org-Zeitlimit](https://cron-job.org/en/faq/), [AgentMail-Idempotenz](https://www.agentmail.to/docs/knowledge-base/preventing-duplicate-sends).
