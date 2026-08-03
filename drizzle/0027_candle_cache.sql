-- Eigener Kerzenspeicher — der letzte offene Punkt aus dem Replay-Trainer-Plan.
--
-- AUSGANGSLAGE
-- Kerzen wurden bei jedem Bedarf beim Anbieter geholt und nur kurz im
-- Prozess-Zwischenspeicher gehalten (`unstable_cache`, 15 Min intraday, 12 h
-- darüber). Nach einem Neustart war alles weg. Damit galt für die Historie
-- immer genau das, was Yahoo GERADE hergibt — und das ist bei
-- 15-Minuten-Kerzen ein Fenster von 60 Tagen. Was älter ist, ist beim Anbieter
-- endgültig verloren.
--
-- Für ein Journal ist das nicht nur beim Replay-Trainer ein Problem: Der
-- Bot-Zwilling und die MAE/MFE-Messung scheitern an Trades, deren Kerzen aus
-- dem Anbieterfenster gefallen sind, und ein Yahoo-Ausfall bedeutet einen
-- leeren Chart statt eines Kurses mit Zeitstempel.
--
-- WAS SICH ÄNDERT
-- Was einmal geholt wurde, bleibt hier liegen. Der Vorrat wächst dadurch über
-- das hinaus, was die Quelle überhaupt noch kennt: Wer heute 60 Tage
-- 15-Minuten-Kerzen holt und in drei Monaten wieder, hat dann rund 150 Tage —
-- ohne dass irgendein Anbieter sie noch liefern würde.
--
-- WARUM OHNE `userId`
-- Eine Kerze ist keine Nutzerdatei, sondern eine öffentliche Marktbeobachtung:
-- Apple hatte am selben Tag für jeden denselben Schlusskurs. Schlüssel ist
-- deshalb das ANBIETER-Symbol (`BTC-USD`, nicht `BTC`) — dieselbe Entscheidung
-- wie bei `quote_snapshot` (0019): dasselbe Papier in zwei Watchlists ist eine
-- Abfrage, nicht zwei.
--
-- KEIN BACKFILL. Der Speicher füllt sich ab dem ersten Abruf; bis dahin
-- verhält sich alles wie bisher. Additiv und idempotent, mehrfach ausführbar.

CREATE TABLE IF NOT EXISTS "candle_cache" (
  -- Das Symbol, unter dem der Anbieter das Papier führt (`CL=F`, `BTC-USD`),
  -- NIE der Rohticker aus der Watchlist.
  "symbol"   text NOT NULL,
  -- 15min | 30min | 1h | 4h | 1day | 1week | 1month
  "interval" text NOT NULL,
  -- Unix-Sekunden des Kerzen-BEGINNS (UTC), wie in `Candle.time`.
  "time"     integer NOT NULL,
  "open"     double precision NOT NULL,
  "high"     double precision NOT NULL,
  "low"      double precision NOT NULL,
  "close"    double precision NOT NULL,
  "volume"   double precision NOT NULL DEFAULT 0,
  -- Der Primärschlüssel ist zugleich der einzige Zugriffsweg: „alle Kerzen
  -- dieses Symbols in diesem Intervall, nach Zeit". Ein zweiter Index wäre
  -- toter Schreibaufwand.
  PRIMARY KEY ("symbol", "interval", "time")
);

-- ---------------------------------------------------------------------------
-- Der Zustand je Reihe: Abdeckung und wann sie zuletzt geholt wurde.
--
-- Das ließe sich auch jedes Mal aus `candle_cache` errechnen (MIN/MAX/COUNT
-- über potenziell Millionen Zeilen). Diese Tabelle beantwortet dieselbe Frage
-- mit einer Zeile — und sie trägt die Angabe, die aus den Kerzen gar nicht
-- hervorgeht: wann wir zuletzt beim Anbieter waren. Genau daran hängen die
-- Frischeprüfung beim Lesen und die Rotation im Sammellauf.
CREATE TABLE IF NOT EXISTS "candle_series" (
  "symbol"      text NOT NULL,
  "interval"    text NOT NULL,
  "market"      text,
  "firstTime"   integer,
  "lastTime"    integer,
  "candleCount" integer NOT NULL DEFAULT 0,
  -- Letzter erfolgreicher Abruf beim Anbieter.
  "fetchedAt"   timestamp with time zone,
  -- Letzter Versuch samt Ergebnis — ein Speicher, der sein eigenes Scheitern
  -- verschweigt, sieht aus wie ein leerer Markt.
  "lastError"   text,
  "failCount"   integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("symbol", "interval")
);

-- Der Sammellauf fragt „was ist am längsten nicht geholt worden".
CREATE INDEX IF NOT EXISTS "candle_series_stale_idx"
  ON "candle_series" ("fetchedAt" NULLS FIRST);

-- ---------------------------------------------------------------------------
-- Protokoll der Sammelläufe — dasselbe Muster wie `symbol_sync_run` (0019)
-- und `alert_check_run` (0024). Der Takt kommt von außen (GitHub-Workflow),
-- gehört der App also nicht; ohne dieses Protokoll wäre ein ausgefallener
-- Sammellauf von einem ruhigen Markt nicht zu unterscheiden.
CREATE TABLE IF NOT EXISTS "candle_collect_run" (
  "id"            serial PRIMARY KEY,
  "startedAt"     timestamp with time zone NOT NULL DEFAULT now(),
  "finishedAt"    timestamp with time zone,
  -- cron | manual
  "trigger"       text NOT NULL DEFAULT 'cron',
  "seriesDue"     integer NOT NULL DEFAULT 0,
  "seriesFetched" integer NOT NULL DEFAULT 0,
  "seriesFailed"  integer NOT NULL DEFAULT 0,
  "candlesAdded"  integer NOT NULL DEFAULT 0,
  "error"         text
);

CREATE INDEX IF NOT EXISTS "candle_collect_run_started_idx"
  ON "candle_collect_run" ("startedAt" DESC);
