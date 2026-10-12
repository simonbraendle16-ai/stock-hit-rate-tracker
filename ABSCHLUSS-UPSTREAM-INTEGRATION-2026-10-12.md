# Abschluss der lokalen Upstream-Integration

Stand: 12.10.2026. **Lokal repariert, integriert, validiert und als Reparaturbranch normal gepusht; kein main-Merge oder Deployment ausgeführt.** Keine produktiven Handels- oder Datenbankänderungen. Aktueller [Validierungs- und Pushnachweis](VALIDIERUNG-PUSH-2026-10-12.md).

## Branch, Basis und Ursprungssicherung

- Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/`. Hauptcheckout weiterhin sauber auf `main` / `a193227`.
- Neue isolierte Integrationsfläche: `C:/Users/sabin/.codex/worktrees/3b2d/stock-hit-rate-tracker/integration/upstream`.
- Branch: `codex/integration-tracker-upstream-2026-10-12`.
- Basis: `origin/main` = `0ce255e`, 13 Commits nach `a193227`. Der zuvor fehlende Commit `94a45e7` ist jetzt verfügbar. Alte Berichte sind kein aktueller Abnahmenachweis.
- Implementierungscommit: `7f6963c08582231318d9d179aa0dae635f366170` — `Integrate necessary tracker repairs on current upstream contracts`. Der folgende Dokumentationscommit ergänzt diesen Bericht; dessen Hash ist über `git log -1` bestimmbar.
- Vollständiger bisheriger gemeinsamer Stand auf alter Basis gesichert in **`52ec4df`**, Branch `codex/integration-tracker-reparaturen-2026-10-12`, im bisherigen Worktree `3b2d`. Darin bleiben `integration/ursprung-session1/`, die ursprünglichen Berichte und zurückgestellten Archiv-/Zeitgrenzenänderungen erhalten.
- Session-2-Ursprung einschließlich ungetrackter Tests bleibt unverändert im Worktree `C:/Users/sabin/.codex/worktrees/8146/stock-hit-rate-tracker`.

Die Übernahme erfolgte über den gesicherten Commit mit gezielter Auflösung von sieben Konfliktdateien gegen den aktuellen Vertrag. Keine komplette alte Handelsimplementierung über neue Funktionen kopiert. Historische Sicherungspatches werden in der neuen Branch nicht redundant mitgeführt; `52ec4df` enthält den vollständigen Ursprung. Keine Rücksetzung, Bereinigung oder Entfernung der Quellstände. Kein zusätzlicher Executor/Agent. Der bereits erledigte Trading-Assistent-Pfadfix und alle Skillordner bleiben unverändert.

## Bereits upstream erledigt — bewusst nicht mit alten Varianten ersetzt

`45ec991` und die nachfolgenden Handelsaktionsänderungen ersetzen das historische Neun-Fragen-Gate durch konkrete Planangaben und Risikobestätigung. Maßgeblich ist jetzt `lib/plan-context.ts` mit `planGaps` und `requireCompletePlan`, nicht ein historisches Ja-Flag.

| Frühere Reparatur | Aktueller Vertrag / Entscheidung |
| --- | --- |
| Douglas-Antworten an API-Plänen nachholen | Der bestehende Editor ergänzt bereits den Plan-Kontext. UI und Aktivierung prüfen vollständige Angaben: `components/trade-card.tsx:147`, `lib/trade-position-service.ts:502`. Zusätzlichen Fragenbutton und alten Freigabeservice nicht übernommen; neun Ja-Antworten wären eine neue zusätzliche Bedingung. |
| Gültige/eindeutige Vorabantworten | `lib/pre-trade-questions.ts:24` validiert bereits bekannte eindeutige Schlüssel, Antworten und Textgrenzen. Unverändert erhalten, einschließlich zulässiger unvollständiger historischer Antworten. |
| Editorversion beim Öffnen festhalten | Bereits vorhanden: `components/edit-trade-dialog.tsx:75`, Übergabe `:199`, serverseitige Ablehnung `lib/trade-position-service.ts:622`. |
| Planspeicherung nach beendetem Trade ablehnen | `lib/trade-position-service.ts:626` erlaubt bereits ausschließlich geplant/aktiv, auch `kein_handel` bleibt gesperrt. |
| Demo-Gate vor Ausführung | Bereits vor Symbolauflösung und nochmals unter Lock vorhanden: `lib/demo-run.ts:66`, `:99`. Diese Quelldatei bleibt gegenüber `0ce255e` unverändert. |

Testbelege auf der neuen Basis: `lib/trade-mutations-db.test.ts:68` aktiviert einen vollständigen langfristigen Plan ohne historische Douglas-Zustimmung; `:78` lehnt einen unvollständigen Plan trotz altem Ja-Flag ab. Isolierte PostgreSQL-Tests über PGlite, keine produktive Persistenz. Neuere Währungs-, Historien-, Bewertungs- und atomare API-Versionsfunktionen bleiben erhalten.

## Noch notwendige Reparaturen: Vorher und Nachher

Alle Beispiele sind synthetische Regressionen; keine persönlichen Fehlertexte oder Instrumente wurden erfunden.

| Vorher auf `0ce255e` | Nachher und Beleg |
| --- | --- |
| Teilziel-Ladefehler wurde als leere Liste behandelt; Speichern konnte Stufen entfernen. | Erfolgreiches Laden erforderlich, sichtbare Fehlermeldung, gesperrtes Speichern, verspätete Antworten verworfen. `components/edit-trade-dialog.tsx:107`, `:160`, `:284`, `:340`. Bestehender Management-/Versionsvertrag erhalten. |
| Offener Aktivierungsdialog konnte einen inzwischen geänderten Plan aktivieren. | Beim Öffnen festgehaltene Version bleibt bei Refresh stabil und wird vor Schreibzugriff geprüft. `components/trade-card.tsx:640`, `:666`, `lib/trade-position-service.ts:495`. Gegenfälle: veraltete Version ohne Status-/Ereignisschreiben (`lib/trade-mutations-db.test.ts:62`), gültige aktuelle Aktivierung (`:68`). Neue Option optional; API behält ihre bestehende atomare Versionsprüfung. |
| Negative/unendliche Planpreise passierten Wahrheitswertprüfung; Antwort-/Kontextprüfung erst nach möglicher Instrumentanlage. | Endliche positive Einstieg-/Stopwerte und vorhandene Antwort-/Kontextvalidierung vor Instrumentauflösung: `lib/create-trade-service.ts:366`, `:369`. Tests für beide Preisfelder und doppelte Antworten ohne Provider-/Instrument-Schreibzugriff: `lib/trade-instrument-integration.test.ts:39`, `:47`. |
| Krypto-Paarwährung/Trennzeichen konnten verändert werden. | `BTC/EUR`, `BTCEUR`, `BTC-USDT` behalten das gewählte Paar. `lib/market-data/resolve.ts:293`; `lib/market-data/resolve-path.test.ts`. |
| Expliziter Handelsplatz konnte durch andere Notierung verdrängt werden; unterschiedliche Firmennamen konnten zusammenfallen. | Explizite Kandidaten begrenzen; Tickerwurzel/Bilanzwährung allein genügen nicht zur Identität. `lib/market-data/resolve.ts:246`, `:371`, `:571`; `resolve-path.test.ts`. |
| Suchauswahl ohne Kursbestätigung konnte automatisch ersetzt werden. | Gewähltes Anbieter-Symbol atomar gepinnt und ungeprüft speichern, bis Bestätigung gelingt; kein automatischer Ersatz. `app/actions/stocks.ts:298`, `:322`, `app/actions/symbols.ts:260`; `lib/market-data/search-save.test.ts`. Freie Anlage bleibt erhalten. |
| `findInstrumentFor` konnte `LSE:EXM` vor dem Resolver an `EXM.DE` hängen oder früh mehrdeutig zurückkehren. | Grundticker-Rückfall nur bei unqualifizierter Eingabe, exakte Treffer vorrangig. `lib/instrument-link.ts:132`. LSE-Präfix ergibt beim Identitätsvergleich korrekt `EXM.L`: `lib/market-data/resolve.ts:490`. `lib/trade-instrument-integration.test.ts` prüft London/Xetra, unqualifizierten Gegenfall und tatsächliche Anlage mit korrekter stockId. |
| Yahoo konnte Abrufzeit als Kurszeit oder ungültige Preise liefern. | Endliche positive Preise und belegte Zeit aus derselben Quelle: `lib/market-data/yahoo.ts:447`, `:546`, `:551`; `lib/market-data/yahoo-quote.test.ts`. |
| Binance konnte USD-Anfrage mit USDT-Kerzen erfüllen. | USD bleibt USD, kein USDT-Ersatz: `lib/market-data/binance.ts:24`; `lib/market-data/history.test.ts`. |
| Watchlist zeigte Abrufalter statt Kursalter. | Anzeige aus quotedAt; fehlende/ungültige/künftige Zeit ausdrücklich unbekannt. `components/watchlist/watchlist-grid.tsx:303`, `:398`, `lib/market-data/quote-age.ts:2`; 15 Fälle in `quote-age.test.ts`. |

Gemeinsame Anlage-Schnittstelle geprüft: `addStock` verbindet ausschließlich eigene unverknüpfte Trades mit exakt gleichem Ticker (`app/actions/stocks.ts:352`); bestehende Zuordnungen werden nicht überschrieben. Die Trade-Anlage nutzt weiterhin `findInstrumentFor` und den Resolver. Neuere Instrumentformular-/Schemaabfragen aus `62e9e07` bleiben erhalten.

## Demo- und Rückwirkungsgrenze

Aktivierung und Planspeicherung führen über `withManualTrade` (`app/actions/trades.ts:1224`, `:1229`) zunächst `runDemoFills` (`lib/manual-trade.ts:16`) und danach die Aktion (`:27`) aus. Auf alter Basis `a193227` konnte ein langfristiger ungeprüfter Plan während dieses vorgeschalteten Abgleichs bei Kursberührung aktiviert werden. Die erste Reparatur schloss dies anhand des damaligen Neun-Fragen-Vertrags.

Auf der neuen Basis prüft bereits Upstream `requiresPreTradeGate` zusammen mit `planGaps` vorab und unter Lock (`lib/demo-run.ts:66`, `:99`); manuelle Aktivierung verlangt denselben vollständigen Plan (`lib/trade-position-service.ts:502`). Nachherfall: Ein unvollständiger langfristiger Plan bleibt trotz historischem Ja-Flag und Kursberührung geplant; `lib/demo-run.integration.test.ts:132`. Vollständige und schnelle Pläne behalten die upstream getesteten Wege.

**Kein zusätzlicher Archiv-Guard, keine Freigabe-Zeitgrenze, keine neue Rückwirkungsregel übernommen.** `lib/demo-run.ts` und `lib/manual-trade.ts` bleiben vollständig auf Upstreamstand. Ursprüngliche zusätzliche Änderungen liegen ausschließlich in der Ursprungssicherung. Bestehende upstream Zeitgrenzen wurden nicht umdefiniert.

## Einmalige Verifikation auf der neuen Basis

- `node node_modules/vitest/vitest.mjs run`: **79 Dateien, 1.258 Tests bestanden**, keine Fehler. Ein Gesamtlauf nach Übertragung/Anpassung, keine Nachtests erforderlich.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: bestanden.
- `git diff HEAD --check`: bestanden, einschließlich aller Reparaturen vor dem Implementierungscommit.
- Alte Zahlen 1.168/3 beziehungsweise 59 gelten ausschließlich für die alte Basis, nicht als Nachweis dieser Integration.
- Isolierte DB-Tests mit PGlite und simulierte Providerantworten; keine produktiven Trades verwendet.

Die Integrationsfläche hat eigene Abhängigkeiten nach unveränderter Upstream-Lockdatei. Installationsskripte übersprungen; nur das fehlende gelockte Testpaket PGlite 0.5.8 öffentlich geladen, keine Updates/Käufe.

Offengelegter Werkzeug-Nebeneffekt: pnpm erkannte zunächst den übergeordneten Workspace in `C:/Users/sabin` und begann dessen Abhängigkeiten einzurichten. Dieser Lauf wurde abgebrochen; die Tracker-Installation danach mit `--ignore-workspace` isoliert ausgeführt. Der berührte übergeordnete `node_modules`-Ordner wurde anschließend mit `pnpm --ignore-workspace install --frozen-lockfile --ignore-scripts` nach seiner bestehenden Lockdatei vervollständigt: **Exit 0**. Der Offlineversuch benötigte noch das gelockte öffentliche PostCSS-Paket; dieses wurde nachgeladen. Keine Versionen aktualisiert, keine Installationsskripte oder Dienste gestartet, keine dortigen Quell-/Env-/Skilldateien bearbeitet. Dies ist ein zusätzlicher lokaler Abhängigkeitsnebeneffekt, keine Tracker-Reparatur und keine Funktionsabnahme anderer Dienste. Wiederherstellungslog liegt lokal ignoriert in `.test-tools/dependency-recovery.log`.

## Geänderte Reparaturdateien

`app/actions/stocks.ts`, `app/actions/symbols.ts`, `components/edit-trade-dialog.tsx`, `components/trade-card.tsx`, `components/watchlist/watchlist-grid.tsx`, `lib/create-trade-service.ts`, `lib/demo-run.integration.test.ts`, `lib/instrument-link.ts`, `lib/trade-position-service.ts`, `lib/trade-mutations-db.test.ts`, `lib/trade-instrument-integration.test.ts`, `lib/market-data/binance.ts`, `lib/market-data/history.test.ts`, `lib/market-data/quote-age.ts`, `lib/market-data/quote-age.test.ts`, `lib/market-data/resolve.ts`, `lib/market-data/resolve-path.test.ts`, `lib/market-data/search-save.test.ts`, `lib/market-data/yahoo.ts`, `lib/market-data/yahoo-quote.test.ts`.

Dazu dieser Abschluss und zwei als historisch gekennzeichnete Berichte. Keine Schema-, Auth-, Sicherheits- oder Skilländerungen, keine Env-/Runtimeartefakte im Commit.

## Offene Grenzen und Browserstatus

- Exakte Nutzerfehlertexte und Instrumente fehlen. Die synthetischen Ursachen beweisen nicht den Vorfall vom 11.10. oder seine abendliche Erholung.
- Bestehende Instrumentzuordnungen, Kurs-Snapshots und Kursreihen nicht bereinigt.
- Produktive UI/API-Prüfung ohne passende Konfiguration offen. Keine Secrets ausgegeben, aus Altpfaden übernommen oder neu eingerichtet. Verfügbare Git-Historie ist kein Nachweis der tatsächlich laufenden Produktionsrevision.
- Historische lokale echte Edge-Prüfung mit synthetischen Daten bestätigte unter anderem Teilziel-Ladefehler und gesperrtes Speichern. Sie ersetzt keine Browserabnahme dieser neuen Basis.
- Session-2-Browserinventur wurde automatisch wegen möglicher Offenlegung privater Tabs abgelehnt. Nicht wiederholt/umgangen. Keine neue produktive oder kombinierte Browserabnahme behauptet.
- Normaler Push der gemeinsamen Reparaturbranch am 12.10.2026 nach neuer ausdrücklicher Autorisierung bestätigt; siehe [Pushnachweis](VALIDIERUNG-PUSH-2026-10-12.md). Kein main-Merge, Deploymentbefehl, persönlicher Testtrade, Upgrade, Reset oder Kauf. **Die gepushte Branch ist weder produktiv abgenommen noch als deploybereit freigegeben.**
