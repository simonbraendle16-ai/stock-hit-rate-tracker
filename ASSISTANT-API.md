# Trading-Journal-API

Stand: 23.09.2026. Basis: `https://stock-hit-rate-tracker-astra-quest.vercel.app/api/assistant/v1`. Die API ergänzt `/journal` und `/settings/assistant-api`; sie führt keine Broker-Orders aus.

## Zugang

Nach Anmeldung unter `/settings/assistant-api` ein persönliches, widerrufbares Token mit den benötigten Rechten erstellen: `trades:read`, `trades:write`, `journal:read`, `journal:write`. HTTP-Header: `Authorization: Bearer <Token>`. Nur der Token-Hash liegt in der Datenbank. Die API bestimmt den Nutzer aus dem Token und prüft Eigentum aller referenzierten Daten. Eine gesendete `userId` ist nicht maßgeblich.

Den Schlüssel nie in Git, Journaltext oder Logs speichern. Lokal können `ASSISTANT_API_BASE_URL` und `ASSISTANT_API_TOKEN` in der gitignorierten `.env.local` des App-Repositories liegen. Das produktive Backend benötigt kein eigenes Token.

## Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/portfolios` | Eigene Depots |
| GET | `/trades` | Trades; Filter `portfolioId`, `from`, `to`, `limit`, `cursor` |
| GET | `/trades/{id}` | Trade mit Ereignissen und Zielen |
| POST | `/trades` | Geplanten Trade anlegen |
| PATCH | `/trades/{id}` | Notizen, Strategie, Setup-Tags korrigieren |
| GET | `/journal` | Einträge; Filter `tradeId`, `limit`, `cursor` |
| POST/PATCH | `/journal`, `/journal/{id}` | Assistenten-Eintrag anlegen/korrigieren |
| GET | `/insights` | Erkenntnisse; Filter `status`, `limit`, `cursor` |
| POST/PATCH | `/insights`, `/insights/{id}` | Erkenntnis anlegen/korrigieren |

Listen liefern `{ "items": [...], "nextCursor": null | "..." }`, maximal 100 Datensätze pro Seite. Zeitangaben sind ISO-8601/UTC. Den gelieferten Cursor unverändert für die nächste Seite verwenden.

`POST /trades` benötigt einen UUID-Header `Idempotency-Key` und `portfolioId`, `ticker`, `market`, `tradeKind`, `direction`, `entryPrice`, `stopLoss`, `takeProfit` sowie `source: {"kind":"user_statement","capturedAt":"...","confirmedByUser":true}`. Optional: `strategy`, `setupTags`, `investedAmount`, `leverage`, `contracts`, `feeEntry`, `feeExit`, `broker`, `notes`. Gleicher Schlüssel und Body ergeben denselben Trade; anderer Body ergibt 409. Es werden nur geplante Trades angelegt. Aktivierung, Abschluss und Ausführungsereignisse bleiben in der App.

Alle PATCH-Routen benötigen `X-Expected-Version: <aktuelle Version>`; veraltete Version ergibt 409. `If-Match` nicht verwenden, da Vercel ihn vor der Route mit 412 beantwortet. Trade-PATCH ändert keine Planpreise oder ausgeführten Trades.

Journal-POST braucht mindestens `situation`; optional: `tradeId`, `occurredAt`, `intention`, `action`, `thoughts`, `reflection`, `ruleRef`, `sourceRefs`. API-Einträge sind stets als `assistant_interpretation` gekennzeichnet. Erkenntnis-POST braucht `statement`; optional: `area`, `status`, `evidenceRefs`, `counterEvidenceRefs`, `limits`, `proposal`. Status: `hypothesis`, `supported`, `contradicted`, `discarded`. Ein Beleg ist `{ "kind": "trade" | "journal", "id": "..." }` und muss dem Nutzer gehören. `supported` erfordert mindestens einen Beleg. Eine Erkenntnis ist keine verbindliche Trading-Regel.

Fehler: 400 ungültige Anfrage, 401 ungültiges Token, 403 fehlendes Recht, 404 fremder/fehlender Datensatz, 409 Versions-/Idempotenzkonflikt, 422 fachlicher Fehler, 503 Dienst nicht verfügbar.

## Betrieb und Grenzen

Migrationen: `drizzle/0038_journal_insights.sql`, `0039_assistant_api_tokens.sql`, `0040_assistant_trade_requests.sql`. Sie sind auf der produktiv verwendeten Neon-Datenbank angewendet. Für eine neue Datenbank erst 0038, dann `node scripts/apply-assistant-migrations.mjs --dry-run` und `node scripts/apply-assistant-migrations.mjs`; nicht blind erneut anwenden.

Prüfung: `pnpm test` und `pnpm exec tsc --noEmit --incremental false`. Die Smoke-Skripte unter `scripts/smoke-assistant-*.mjs` verwenden isolierte Daten. Produktive Lese-, Schreib-, Konflikt- und Widerrufstests liefen am 23.09.2026 erfolgreich. Der persönliche Token wurde danach nur lesend geprüft: 26 Trades, 2 Depots. Insgesamt liegen 52 Trades über mehrere Accounts in der Datenbank.

Nicht umgesetzt: Import historischer Ausführungen, Broker-Anbindung, Astra-Synchronisation, Volltextsuche und Änderungshistorie. Erkenntnisse liegen derzeit im Tracker. Unsichere Angaben aus Gesprächen nicht als Trade-Fakten schreiben.
