-- Replay-Trainer, dritte Ausbaustufe: liegende Orders, Teilziele, parallele Trades.
--
-- AUSGANGSLAGE UND WARUM SIE FALSCH GEMESSEN HAT
-- Bis hierher galt der Einstieg im Moment des Festschreibens als AUSGEFÜHRT.
-- Gemessen wurde ab der Kerze danach — auch dann, wenn der geplante
-- Einstiegskurs nie gehandelt wurde. Damit gingen Trades in die Trefferquote
-- ein, die es im Markt nie gegeben hätte: Wer ein Limit 3 % unter dem Kurs
-- plant und nie bedient wird, hat nicht gewonnen und nicht verloren — er hat
-- nicht gehandelt. Genau diese Zeilen haben die Quote bisher verwässert.
--
-- AB HIER liegt eine festgeschriebene These als ORDER im Markt und wird erst
-- aktiv, wenn der Kurs den Einstieg berührt. Die Prüfung dafür ist nicht neu:
-- `simulateMissedTrade` (`lib/bot-twin.ts`) macht das für echte Trades seit
-- Etappe 5 mit `directionForLevel` + `candleReachesLevel`. Der Trainer benutzt
-- dieselben Helfer — zwei Auslegungen von „berührt" wären zwei Wahrheiten.
--
-- WARUM `orderStatus` AUF 'ausgeloest' VORBELEGT IST
-- Kein Backfill, keine Neuberechnung. Bestehende Trainer-Trades wurden als
-- sofort gefüllt gemessen; ihr Ergebnis steht und ist einmal-schreibend
-- (`resolveTrainingTrade`). Sie mit der neuen Regel nachzurechnen hieße, eine
-- Statistik rückwirkend zu ändern — dann stimmte keine Zahl mehr, die der
-- Nutzer je gesehen hat. Der Vorgabewert hält sie exakt so, wie sie waren.
--
-- TEILZIELE LIEGEN IN EINER EIGENEN TABELLE, wie `trade_target` bei echten
-- Trades (Migration 0025). Sie als Spalten `takeProfit2`, `takeProfit3` … zu
-- führen hieße, die Zahl der Stufen ins Schema zu gießen und für jede Stufe
-- eine eigene Ausführungsspalte zu tragen. `takeProfit` am Trade bleibt: Es ist
-- die letzte Stufe und der Weg, auf dem Altbestand weiter gemessen wird.
--
-- Additiv und idempotent, mehrfach ausführbar.

-- Wie es der Order ergangen ist.
--   liegt            = festgeschrieben, wartet auf die Berührung des Einstiegs
--   ausgeloest       = Einstieg berührt, der Trade läuft oder ist abgerechnet
--   gestrichen       = vom Nutzer zurückgezogen, bevor sie ausgelöst wurde
--   nicht_ausgeloest = bis zum Ende des Ausschnitts nie berührt
--   invalidiert      = `orderInvalidation` wurde vor dem Einstieg berührt
ALTER TABLE "training_trade"
  ADD COLUMN IF NOT EXISTS "orderStatus" text NOT NULL DEFAULT 'ausgeloest';

-- Die Kerze, in der der Einstieg TATSÄCHLICH berührt wurde — ab hier wird
-- gemessen. `entryCandleTime` bleibt daneben stehen und behält seine Bedeutung:
-- letzte sichtbare Kerze beim Festschreiben, also der Beleg, dass die These vor
-- dem Ergebnis stand. Zwei verschiedene Zeitpunkte, zwei Spalten; in eine
-- zusammengelegt ließe sich der Beleg nicht mehr von der Messung trennen.
ALTER TABLE "training_trade"
  ADD COLUMN IF NOT EXISTS "filledCandleTime" integer;

-- Preisniveau, das die liegende Order tötet, bevor sie ausgelöst wird.
--
-- Bewusst NICHT `invalidation` mitbenutzt: Die trägt die Invalidation der
-- Elliott-ZÄHLUNG („ab hier war die Zählung falsch"). Beides in eine Spalte zu
-- legen hieße, zwei Aussagen zu vermengen, die verschieden ausgehen dürfen —
-- eine Zählung kann halten, während die Order nicht mehr sinnvoll ist.
ALTER TABLE "training_trade"
  ADD COLUMN IF NOT EXISTS "orderInvalidation" double precision;

ALTER TABLE "training_trade"
  ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz;

-- Höchste erreichte Zielstufe (0 = keine). Steht neben `outcome`, weil
-- `outcome` nach Absprache schon bei der ERSTEN erreichten Stufe auf 'ziel'
-- geht — ohne diese Spalte ließe sich ein knapp mitgenommenes TP1 nicht mehr
-- von einem voll durchgelaufenen Plan unterscheiden.
ALTER TABLE "training_trade"
  ADD COLUMN IF NOT EXISTS "reachedTarget" integer NOT NULL DEFAULT 0;

-- Die Teilziele einer geübten Order. Aufbau wie `trade_target`, damit beide
-- Seiten der App dieselbe Form haben und `lib/trade-targets.ts` für beide gilt.
CREATE TABLE IF NOT EXISTS "training_trade_target" (
  "id"        serial PRIMARY KEY,
  "tradeId"   integer NOT NULL,
  -- Eigenständig neben tradeId (wie bei `trade_target`): Die Abfrage kommt ohne
  -- Join aus und filtert trotzdem hart auf den Eigentümer.
  "userId"    text NOT NULL,
  -- 0-basiert, aufsteigend nach Abstand zum Einstieg (Stufe 1 = am nächsten).
  -- Hergestellt beim Speichern, nicht vom Formular erwartet.
  "sortOrder" integer NOT NULL DEFAULT 0,
  "price"     double precision NOT NULL,
  -- Anteil der ANFANGSposition auf dieser Stufe (0..100]. Die Summe darf unter
  -- 100 bleiben — der Rest läuft dann bis zur letzten Stufe.
  "sharePct"  double precision NOT NULL,
  -- Ausführung: beide zusammen gesetzt oder beide leer.
  "executedCandleTime" integer,
  "executedPrice"      double precision,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "training_trade_target_trade_idx"
  ON "training_trade_target" ("tradeId", "sortOrder");

-- Offene Orders einer Sitzung zu finden ist der häufigste Zugriff im Replay:
-- je Kerze wird geprüft, was ausgelöst hat.
CREATE INDEX IF NOT EXISTS "training_trade_status_idx"
  ON "training_trade" ("sessionId", "orderStatus");
