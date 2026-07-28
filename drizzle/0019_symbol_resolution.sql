-- Etappe 9 „Symbolauflösung und Kurs-Synchronisierung"
--
-- Das Problem: `stock.ticker` ist das, was der Nutzer eingetippt hat, und ging
-- bisher ungeprüft als Anbieter-Symbol raus. Traf es nicht zufällig genau die
-- Schreibweise des Anbieters, gab es keinen Kurs — ohne jeden Hinweis, warum.
-- Betroffen war der halbe Bestand: TradingView-Notation (`CL1!`), Heimatbörsen-
-- Ticker ohne Suffix (`ADS` statt `ADS.DE`), Indizes (`DAX` statt `^GDAXI`),
-- Krypto-Paare unter „aktien" (`BTCUSD` statt `BTC-USD`).
--
-- Die Antwort besteht aus zwei Teilen:
--
-- 1. Der eingetippte Ticker bleibt unangetastet — er ist die Absicht des
--    Nutzers und die Verknüpfung zu den Trades (`createTrade` verknüpft über
--    den Ticker). Daneben tritt das AUFGELÖSTE Anbieter-Symbol als eigene
--    Spalte. Beides getrennt zu halten ist der Kern: der Nutzer darf weiter
--    „CL1!" sehen und schreiben, während die Abfrage „CL=F" benutzt.
--
-- 2. Ein dauerhafter Kursspeicher (`quote_snapshot`). Bisher fragte die
--    Watchlist bei jedem Aufruf je Symbol beim Anbieter an — bei ~90
--    Instrumenten gegen ein Limit von 8 Anfragen pro Minute. Ab jetzt füllt ein
--    Hintergrundlauf den Speicher gebündelt, und die Oberfläche liest nur noch
--    aus der Datenbank. Nebenwirkung mit Absicht: Fällt der Anbieter aus, steht
--    dort weiterhin der letzte bekannte Kurs samt Zeitstempel statt eines
--    leeren Feldes.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
-- Kein DROP, kein RENAME, keine inhaltlich geänderte Zeile. Kein Backfill in
-- diesem Skript: die Auflösung selbst passiert im Anwendungscode
-- (`scripts/sync-symbols.mjs` bzw. der Cron-Route), weil sie echte Kursabrufe
-- braucht und protokolliert werden soll.

-- --- Teil 1: Auflösung am Instrument ---------------------------------------

ALTER TABLE "stock"
  -- Das beim Anbieter tatsächlich existierende Symbol, z. B. `CL=F`, `ADS.DE`,
  -- `^GDAXI`. NULL = noch nicht aufgelöst.
  ADD COLUMN IF NOT EXISTS "providerSymbol" text,
  -- Welcher Anbieter dieses Symbol versteht: yahoo | twelvedata | binance.
  ADD COLUMN IF NOT EXISTS "provider" text,
  -- ok | ambiguous | unresolved. NULL = noch nie versucht.
  ADD COLUMN IF NOT EXISTS "resolutionStatus" text,
  -- 0–100. Ab 72 übernimmt der Resolver ohne Rückfrage (siehe resolve.ts).
  ADD COLUMN IF NOT EXISTS "resolutionConfidence" integer,
  -- Was der Anbieter zu diesem Symbol sagt — dient der Sichtprüfung durch den
  -- Nutzer („ist das wirklich meine Aktie?").
  ADD COLUMN IF NOT EXISTS "resolvedName" text,
  ADD COLUMN IF NOT EXISTS "resolvedExchange" text,
  ADD COLUMN IF NOT EXISTS "resolvedCurrency" text,
  -- Begründung im Klartext, wird in der Watchlist angezeigt.
  ADD COLUMN IF NOT EXISTS "resolutionNote" text,
  -- Die geprüften Alternativen als JSON-Array — Grundlage der manuellen
  -- Korrektur, damit die Oberfläche dafür nichts neu suchen muss.
  ADD COLUMN IF NOT EXISTS "resolutionCandidates" text,
  -- Vom Nutzer von Hand gesetzt? Dann fasst die Automatik es nie wieder an.
  ADD COLUMN IF NOT EXISTS "resolutionPinned" boolean NOT NULL DEFAULT false,
  -- Auflösung ist eine Näherung (z. B. Gold-Future statt Spot, den es bei
  -- keinem Gratis-Anbieter gibt). Wird in der Oberfläche ausgewiesen.
  ADD COLUMN IF NOT EXISTS "resolutionApproximate" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "resolvedAt" timestamp;

-- Wertebereich hart begrenzen: an `resolutionStatus` hängt, ob die Oberfläche
-- einen Kurs oder einen Reparaturhinweis zeigt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_resolutionStatus_check'
  ) THEN
    ALTER TABLE "stock"
      ADD CONSTRAINT "stock_resolutionStatus_check"
      CHECK ("resolutionStatus" IS NULL
             OR "resolutionStatus" IN ('ok', 'ambiguous', 'unresolved'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_provider_check'
  ) THEN
    ALTER TABLE "stock"
      ADD CONSTRAINT "stock_provider_check"
      CHECK ("provider" IS NULL
             OR "provider" IN ('yahoo', 'twelvedata', 'binance'));
  END IF;
END $$;

-- Der Synchronisierungslauf sucht gezielt die noch offenen und die ältesten
-- Auflösungen — dafür ein Index, sonst wird das bei wachsender Watchlist ein
-- vollständiger Tabellendurchlauf.
CREATE INDEX IF NOT EXISTS "stock_resolution_idx"
  ON "stock" ("resolutionStatus", "resolvedAt");

-- --- Teil 2: dauerhafter Kursspeicher --------------------------------------

-- Bewusst NICHT je Instrument, sondern je Anbieter-Symbol: Halten zwei Nutzer
-- (oder zwei Watchlist-Einträge) dasselbe Papier, wird es einmal abgefragt und
-- einmal gespeichert. Das ist genau die Ersparnis, die die Sache erst tragfähig
-- macht.
CREATE TABLE IF NOT EXISTS "quote_snapshot" (
  "provider" text NOT NULL,
  "symbol" text NOT NULL,
  "price" double precision NOT NULL,
  "previousClose" double precision,
  "changePct" double precision,
  "currency" text,
  "exchange" text,
  "name" text,
  -- Zeitpunkt des Kursstands beim Anbieter (Unix-Sekunden) — die Grundlage für
  -- die ehrliche Beschriftung „Kurs von 14:32". NICHT der Zeitpunkt des Abrufs.
  "quotedAt" integer NOT NULL,
  -- Wann wir ihn geholt haben. Differenz zu `quotedAt` zeigt, ob der Markt
  -- geschlossen ist oder unsere Synchronisierung hängt.
  "fetchedAt" timestamp NOT NULL DEFAULT now(),
  -- Letzter Fehler beim Aktualisieren; der Kurs oben bleibt trotzdem stehen,
  -- damit ein Ausfall kein leeres Feld erzeugt.
  "lastError" text,
  "failCount" integer NOT NULL DEFAULT 0,
  CONSTRAINT "quote_snapshot_pkey" PRIMARY KEY ("provider", "symbol")
);

CREATE INDEX IF NOT EXISTS "quote_snapshot_fetched_idx"
  ON "quote_snapshot" ("fetchedAt");

-- --- Teil 3: Protokoll der Synchronisierungsläufe ---------------------------

-- Damit nachvollziehbar ist, ob die Automatik wirklich läuft — die
-- ausdrückliche Anforderung war, nicht mehr nachhaken zu müssen. Ohne Protokoll
-- ließe sich das nur vermuten.
CREATE TABLE IF NOT EXISTS "symbol_sync_run" (
  "id" serial PRIMARY KEY,
  "startedAt" timestamp NOT NULL DEFAULT now(),
  "finishedAt" timestamp,
  -- cron | manual | onload
  "trigger" text NOT NULL DEFAULT 'cron',
  "symbolsTotal" integer NOT NULL DEFAULT 0,
  "quotesUpdated" integer NOT NULL DEFAULT 0,
  "resolvedNew" integer NOT NULL DEFAULT 0,
  "stillUnresolved" integer NOT NULL DEFAULT 0,
  "error" text
);

CREATE INDEX IF NOT EXISTS "symbol_sync_run_started_idx"
  ON "symbol_sync_run" ("startedAt" DESC);
