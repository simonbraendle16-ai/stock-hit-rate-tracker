# Session 1: geplante Trades, Speicherung und Freigabe

> Historischer Session-1-Abschluss vor gemeinsamer Integration. Aktuell gilt der [Upstream-Abschluss](ABSCHLUSS-UPSTREAM-INTEGRATION-2026-10-12.md). Der unveränderte Ursprung einschließlich zurückgestellter Archiv-/Rückwirkungsanteile bleibt im bisherigen Worktree `3b2d` unter `integration/ursprung-session1/` und im Sicherungscommit `52ec4df` erhalten.

Stand: 12.10.2026. Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/`.
Reparatur ausschließlich im vorhandenen Worktree `C:/Users/sabin/.codex/worktrees/3b2d/stock-hit-rate-tracker`, detached HEAD auf `a193227`. Haupt-Repository zu Beginn und beim Abschlussvergleich unverändert. Keine neue Codex-Session, Zusammenführung, Commits, Pushes oder Veröffentlichung.

## Belegte lokale Befunde und Änderungen

- Ein langfristiger Assistenten-POST erstellt korrekt einen geplanten Trade ohne Douglas-Antworten. Die Aktivierung verlangt `preTradeAnswered`; bislang gab es keinen UI-Weg, die Antworten an bestehenden Trades nachzuholen. Neuer Button „Neun Fragen / Freigeben“ verwendet den bestehenden Fragen-Dialog. Freigabe speichert Antworten, aktiviert aber keinen Trade. Ein Nein erhält die Sperre. Authentifizierung, Eigentum, geplanter Status und aktuelle Version werden geprüft; die Freigabe läuft unter der bestehenden Depot-/Trade-Sperre.
- Das bisherige Gate prüfte nur Anzahl und Ja-Werte. Neun Kopien derselben Antwort genügten. Die gemeinsame Normalisierung prüft nun alle neun eindeutigen Schlüssel und gültige Antwortwerte und übernimmt den kanonischen Fragetext. Ungültige Antworten werden vor möglichen Instrument-Schreibzugriffen abgelehnt.
- Der Demo-Automat und die Archiv-Reparatur prüften vor einem geplanten Einstieg das Douglas-Gate nicht. Beide respektieren jetzt dieselbe Sperre; schnelle Trades bleiben ausgenommen. Der Automat prüft auch nochmals innerhalb der Sperrtransaktion. Bei erstmaliger positiver Demo-Freigabe beginnt die Ausführungsprüfung ab dem Freigabezeitpunkt statt anhand früherer Kurse.
- Der Editor behandelte einen Fehler beim Laden der Teilziele als leere Liste. Beim Speichern wurde diese Liste explizit übermittelt und konnte vorhandene Teilziele entfernen. Jetzt bleibt Speichern bis zum erfolgreichen Laden gesperrt; Fehler sind sichtbar, verspätete Antworten eines geschlossenen Dialogs werden ignoriert.
- Editor, Aktivierungsdialog und Fragen-Dialog merken sich die beim Öffnen angezeigte Planversion. Serverprüfungen lehnen überholte Eingaben ab. Beim erneuten Öffnen lädt der Editor aktuelle Feldwerte statt alter Entwürfe. Die vorhandene Datenbankmigration `0040_assistant_trade_requests.sql` erhöht Versionen per Update-Trigger; keine neue Migration erforderlich oder ausgeführt.
- Planänderungen nach `kein_handel` werden wie andere beendete Trades abgelehnt. Die bisherige Prüfung erfasste nur abgeschlossen/abgebrochen.
- Anlage prüft Einstieg und Stop auf endliche positive Zahlen; negative oder unendliche Werte konnten zuvor die einfache Wahrheitswertprüfung passieren. Kursziel bleibt Pflicht. Bestehende Richtungs-, Teilziel-, Emotions-, Deckungs- und Plan-Lock-Regeln bleiben erhalten.

Die exakte Meldung und die konkreten Fälle vom Nachmittag des 11.10.2026 fehlen. Die lokalen Defekte sind damit keine rückwirkend bewiesene Erklärung für diesen Vorfall oder dessen spätere Erholung.

## UI, API, Schema und Produktion

Lokales Schema enthält Antworten, Freigabeflag und Version. Der Assistentenvertrag verlangt bestätigte Nutzeraussage, Depot, Ticker, Markt, Erfassungsweg, Richtung und drei Planpreise; Status und Douglas-Freigabe werden nicht aus Assistentenbehauptungen übernommen. Lokaler PATCH akzeptiert nur Notizen, Strategie und Setup-Tags. Dieser Vertrag wurde nicht ungeprüft erweitert.

Die Betriebsunterlagen im Trading-Assistenten nennen seit 06.10. neuere produktive Preis-/Größen-, Actions-, Review- und Revisionsrouten. Der darin genannte Commit `94a45e7` ist in der vorliegenden Git-Historie nicht vorhanden. Das belegt eine Abweichung zwischen lokalem Stand und dokumentiertem Produktionsstand, nicht den aktuellen Produktionscode.

Ein begrenzter produktiver GET-Nachweis war nicht möglich: In der `.env.local` des bestätigten Haupt-Repositorys fehlen `ASSISTANT_API_BASE_URL` und `ASSISTANT_API_TOKEN`. Es wurden nur fehlende Schlüsselnamen ausgegeben. Kein Token wurde übernommen oder erzeugt. Auch die erste Browser-Leseanbindung an den vorhandenen Produktionstab scheiterte am Verbindungszeitlimit. Produktives Schema, Revision, persönlicher Fall und tatsächlicher Schreibablauf bleiben damit unbestätigt. Keine produktiven Trade-Schreibtests oder Authmigration.

## Verifikation

- `node node_modules/vitest/vitest.mjs run`: **62 Dateien, 1.126 Tests bestanden**. Neue Tests in `lib/release-trade-plan.test.ts` und `lib/trade-lifecycle.test.ts`: gültige UI-/API-Anlage, Ja/Nein-Freigabe, kanonische/eindeutige Antworten, Eigentum, Versionen, Statusgrenzen, ungültige Preise, gültiges Speichern, erfolgreiche Aktivierung mit Eröffnungsereignis, schneller Trade und berechtigte Douglas-/Emotions-/Plan-Lock-Ablehnungen. `lib/demo-run.integration.test.ts` prüft außerdem die Demo-Sperre einschließlich Archivweg und den Gegenfall freigegebener/schneller Trades. Persistenz/Auth sind in diesen Tests isoliert gemockt; keine Aussage über produktive Datenbankmigrationen.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: bestanden.
- `git diff --check`: bestanden. Drei geänderte aktive Clientdateien mit `node --check`: bestanden.
- Echte Edge-Sichtprüfung einer lokalen Vorschau mit tatsächlichen Komponenten, erfundenem TEST-Trade und vollständig ersetzten Serveraktionen: Aktivieren gesperrt, neuer Neun-Fragen-Dialog vorhanden, Nein-Hinweis sichtbar, simulierter Teilziel-Ladefehler sichtbar und Speichern gesperrt. Der vollständige Neun-Fragen-Durchlauf im Browser endete an einem Werkzeugzeitlimit; dessen serverseitiger Erfolgsfall ist durch Tests abgedeckt. Vorschau beendet und temporäre Dateien entfernt.
- Abhängigkeiten waren im Worktree nicht installiert. Eine lokale `node_modules`-Junction verwendet die bereits vorhandenen Abhängigkeiten des Haupt-Repositorys; keine Paketänderungen. Vitest benötigte nach Windows-EPERM eine genehmigte Ausführung außerhalb der Prozess-Sandbox.

## Dauerhafter Pfad und Integration

Mit gewährtem Schreibzugriff geändert und zurückgelesen:

- `C:/Users/sabin/Documents/Trading-Assistent/06_Integrationen/Tracker-Zugriff.md`: bestätigter führender Pfad dauerhaft ergänzt.
- Aktive Standardpfade in `scripts/tracker-api.mjs`, `scripts/broker-session.mjs`, `knowledge/config.mjs` dieses Projekts korrigiert. `ASSISTANT_ENV_FILE` bleibt ausdrückliche Überschreibung. Historische Berichte und frühere Installationsskripte nicht umgeschrieben.

Trackeränderungen: `app/actions/trades.ts`, `components/trade-card.tsx`, `components/edit-trade-dialog.tsx`, `lib/create-trade-service.ts`, `lib/pre-trade-questions.ts`, `lib/demo-run.ts`, `lib/demo-run.integration.test.ts`, neue Freigabelogik und beide neuen Testdateien sowie dieser Bericht. Sie liegen als integrierbarer, uncommitteter Worktree-Diff vor.

Session 2 arbeitet in `8146`. Beim Abschlussvergleich ändern sich dort `app/actions/stocks.ts`, `app/actions/symbols.ts`, `components/watchlist/watchlist-grid.tsx`, `lib/market-data/{binance,resolve,yahoo}.ts`, `history.test.ts` sowie neue Kursalter-Logik und Marktdaten-Tests. Keine direkte Dateiüberschneidung zum Prüfzeitpunkt. Fachliche Schnittstelle: Instrumentauflösung beim Anlegen in `lib/create-trade-service.ts`; vor späterer Integration mit Session 2 und dem tatsächlich veröffentlichten Stand abgleichen. Keine fremden Änderungen übernommen oder überschrieben.
