-- Event-Log (Etappe 6): jede Veränderung eines Trades als eigenes Ereignis.
--
-- Zwei strukturelle Schwächen werden damit behoben:
--   1. Ein Trade hatte genau EIN Ende (trade.actualExitPrice) — echte Teilverkäufe
--      ("bei 1 R die Hälfte verkaufen, Rest laufen lassen") waren nicht abbildbar.
--   2. Die Trade-Geschichte war ein JSON-String (trade.ruleViolations) ohne
--      Zeitpunkt, ohne alten/neuen Wert. Aus dem Event-Log entsteht eine lesbare
--      Chronik mit Zeitstempeln.
--
-- Der bestehende ruleViolations-String bleibt erhalten und wird weiter geschrieben
-- (damit die Disziplin-Kennzahlen nicht brechen) — ab jetzt ist er abgeleitet
-- statt führend.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
-- Neue Tabelle, kein Eingriff in "trade": KEIN Backfill. Alt-Trades ohne Events
-- bekommen ihre Timeline zur Anzeigezeit aus vorhandenen Feldern abgeleitet
-- (openedAt / ruleViolations / closedAt) — ohne erfundene Zeitstempel.

CREATE TABLE IF NOT EXISTS "trade_event" (
  "id"        serial PRIMARY KEY,
  -- Bezug auf trade.id. userId steht eigenständig daneben (wie bei price_alert),
  -- damit die Abfrage der Events eines Nutzers ohne Join auf "trade" geht.
  "tradeId"   integer NOT NULL,
  "userId"    text NOT NULL,
  -- Ereignis-Art aus geschlossener Liste (siehe CHECK unten und lib/trade-events.ts).
  "type"      text NOT NULL,
  -- Zeitpunkt des Ereignisses (fachlich); createdAt ist der technische Schreib-Zeitpunkt.
  "at"        timestamp NOT NULL DEFAULT now(),
  -- Nur bei teilverkauf/nachkauf gesetzt: Stückzahl, Ausführungskurs, anteilige Gebühr.
  "quantity"  double precision,
  "price"     double precision,
  "fee"       double precision,
  -- JSON für Level-Ereignisse (stop_verschoben / ziel_geaendert / invalidation_ignoriert):
  -- {"from": 90, "to": 100}.
  "payload"   text,
  "note"      text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- Die Events eines Trades werden immer gebündelt geladen (Timeline, Settlement).
CREATE INDEX IF NOT EXISTS "trade_event_trade_idx"
  ON "trade_event" ("tradeId");

-- --- Wertebereich absichern --------------------------------------------------
-- type ist eine geschlossene Liste (lib/trade-events.ts). Ein Wert außerhalb würde
-- Settlement und Timeline stumm verfälschen. Der Server validiert bereits; die
-- Bedingung hier ist die zweite Linie — genau wie bei 0011/0012.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_event_type_check'
  ) THEN
    ALTER TABLE "trade_event" ADD CONSTRAINT "trade_event_type_check"
      CHECK ("type" IN (
        'eroeffnet', 'teilverkauf', 'nachkauf', 'stop_verschoben',
        'ziel_geaendert', 'invalidation_ignoriert', 'notiz', 'geschlossen'
      ));
  END IF;
END $$;
