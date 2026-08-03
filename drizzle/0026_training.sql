-- Replay-Trainer, Phase 4 „Speicherung" — drei Tabellen für den Trainingsworkflow.
--
-- AUSGANGSLAGE
-- Phase 1 des Trainer-Plans war ein reiner Prototyp: Chart zurückspulen, Kerze
-- für Kerze freigeben, fertig. Nichts davon wurde festgehalten. Damit war die
-- Übung ein Gefühl und keine Messung — man erinnert sich an die Analysen, die
-- aufgegangen sind, und vergisst die anderen. Genau dagegen ist diese App
-- gebaut.
--
-- WARUM DREI TABELLEN UND NICHT EINE
-- Sie tragen drei verschiedene Zeitpunkte, und die Reihenfolge ist der
-- eigentliche Wert der Übung:
--   1. `training_session`  — die Übung samt der VOR dem Aufdecken
--                            festgeschriebenen These (`committedAt`).
--   2. `training_annotation` — die Zeichnungen dazu, so wie sie zum Zeitpunkt
--                            der Analyse aussahen.
--   3. `training_result`   — die Bewertung NACH dem Aufdecken.
-- Läge alles in einer Zeile, ließe sich nicht mehr belegen, dass die These vor
-- dem Ergebnis stand — und eine Übung, deren These man nachträglich anpassen
-- kann, misst nichts.
--
-- WARUM DIE ZEICHNUNGEN NICHT IN `chart_drawing` LANDEN
-- Die Zeichnungen einer Übung hängen an einem historischen Ausschnitt, nicht am
-- Instrument. Lägen sie in `chart_drawing`, tauchten Übungslinien im echten
-- Chart des Instruments auf und würden dort neben echten Plan-Levels stehen.
-- Übung und Ernstfall bleiben getrennt — dieselbe Trennung wie Demo-Depot und
-- Echtgeld (0022).
--
-- KEIN BACKFILL. Es gibt nichts nachzutragen: Vor dieser Migration wurde keine
-- Übung gespeichert. Additiv und idempotent, mehrfach ausführbar.

CREATE TABLE IF NOT EXISTS "training_session" (
  "id"              serial PRIMARY KEY,
  "userId"          text NOT NULL,
  -- Optional: Eine freie Symbol-Eingabe hat kein Instrument in der Watchlist.
  -- Ist es gesetzt, gehen die Kerzen über die Symbolauflösung (Etappe 9/11) —
  -- ein Rohticker liefert sonst womöglich das falsche Papier.
  "stockId"         integer,
  "symbol"          text NOT NULL,
  "market"          text NOT NULL,
  -- Anzeigeform des Charts ('15m' | '30m' | '1h' | '4h' | 'T' | 'W' | 'M').
  "timeframe"       text NOT NULL,
  -- frei | zufall | elliott
  "mode"            text NOT NULL DEFAULT 'frei',
  -- Verdeckt: Symbol und Datum bleiben bis zur Auflösung unsichtbar.
  "blind"           boolean NOT NULL DEFAULT false,
  -- Umfang der geladenen Historie und der gezogene Startpunkt. Beides wird
  -- gespeichert, damit sich eine Übung später nachvollziehen lässt, auch wenn
  -- der Anbieter inzwischen andere Kerzen liefert.
  "candleCount"     integer NOT NULL DEFAULT 0,
  "startIndex"      integer NOT NULL DEFAULT 0,
  -- Unix-Sekunden der ersten, der Start- und der letzten geladenen Kerze.
  "firstCandleTime" integer,
  "startCandleTime" integer,
  "lastCandleTime"  integer,
  -- offen | festgeschrieben | bewertet | abgebrochen
  "status"          text NOT NULL DEFAULT 'offen',

  -- ---- Die These. Ab `committedAt` unveränderlich. -------------------------
  -- long | short | keine ("kein Setup" ist eine vollwertige Antwort)
  "direction"       text,
  "elliottCount"    text,
  "invalidation"    double precision,
  "entryPrice"      double precision,
  "stopLoss"        double precision,
  "takeProfit"      double precision,
  "thesisNote"      text,
  -- JSON-Array der Anzeigeformen, wie `trade.setupTags` (0016).
  "setupTags"       text,
  "committedAt"     timestamp with time zone,

  -- Zeitpunkt des Aufdeckens (Symbol/Datum) — bei `blind` der Moment der
  -- Wahrheit, sonst gleich der Bewertung.
  "revealedAt"      timestamp with time zone,
  "createdAt"       timestamp with time zone NOT NULL DEFAULT now(),
  "finishedAt"      timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_session_mode_check') THEN
    ALTER TABLE "training_session" ADD CONSTRAINT "training_session_mode_check"
      CHECK ("mode" IN ('frei', 'zufall', 'elliott'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_session_status_check') THEN
    ALTER TABLE "training_session" ADD CONSTRAINT "training_session_status_check"
      CHECK ("status" IN ('offen', 'festgeschrieben', 'bewertet', 'abgebrochen'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_session_direction_check') THEN
    ALTER TABLE "training_session" ADD CONSTRAINT "training_session_direction_check"
      CHECK ("direction" IS NULL OR "direction" IN ('long', 'short', 'keine'));
  END IF;
END $$;

-- Der Zugriffsweg ist immer „meine Übungen, neueste zuerst".
CREATE INDEX IF NOT EXISTS "training_session_user_idx"
  ON "training_session" ("userId", "createdAt" DESC);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "training_annotation" (
  "id"        serial PRIMARY KEY,
  "sessionId" integer NOT NULL,
  -- Redundant zur Übung, aber bewusst: jede Abfrage filtert hart auf den
  -- Eigentümer, ohne dafür erst joinen zu müssen (wie `trade_target`, 0023).
  "userId"    text NOT NULL,
  -- Dieselben Typen wie `chart_drawing` (hline, trendline, fib, ew_impulse, …).
  "type"      text NOT NULL,
  -- JSON-Array von Punkten: [{ time (Unix-Sek.), price }]
  "points"    text NOT NULL,
  -- JSON: { color?, dashed?, label? }
  "style"     text,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "training_annotation_session_idx"
  ON "training_annotation" ("sessionId", "id");

CREATE INDEX IF NOT EXISTS "training_annotation_user_idx"
  ON "training_annotation" ("userId");

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "training_result" (
  "id"              serial PRIMARY KEY,
  "sessionId"       integer NOT NULL,
  "userId"          text NOT NULL,
  -- korrekt | teilweise | falsch
  "rating"          text NOT NULL,
  -- JSON-Array aus dem FESTEN Fehler-Katalog (lib/training.ts). Fest, anders
  -- als die Setup-Tags: Nur ein fester Katalog lässt sich über Monate zählen.
  "errorTags"       text,
  "note"            text,
  -- Wie viele Kerzen beim Bewerten aufgedeckt waren — eine Bewertung nach drei
  -- Kerzen ist etwas anderes als eine nach hundert.
  "revealedCandles" integer,
  "createdAt"       timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_result_rating_check') THEN
    ALTER TABLE "training_result" ADD CONSTRAINT "training_result_rating_check"
      CHECK ("rating" IN ('korrekt', 'teilweise', 'falsch'));
  END IF;
END $$;

-- Eine Übung hat genau EINE Bewertung. Zwei wären zwei Wahrheiten über
-- dasselbe Ergebnis — und die zweite entstünde immer erst, nachdem man das
-- Ergebnis kennt.
CREATE UNIQUE INDEX IF NOT EXISTS "training_result_session_uniq"
  ON "training_result" ("sessionId");

CREATE INDEX IF NOT EXISTS "training_result_user_idx"
  ON "training_result" ("userId", "createdAt" DESC);
