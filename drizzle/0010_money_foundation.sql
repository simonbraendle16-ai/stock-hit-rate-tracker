-- Geld-Fundament (Etappe 1): eingefrorene Ordergebühren je Trade, Hebel,
-- Kontowährung, konfigurierbare Standard-Gebühren und Ein-/Auszahlungen.
-- Additiv only (safe für bestehende Daten), idempotent.

-- --- Trade: Gebühren einfrieren + Hebel ------------------------------------
-- feeEntry/feeExit halten die TATSÄCHLICH gezahlte Gebühr fest. Vorher wurde
-- sie bei jedem Aufruf aus einer Konstante (9 €) neu berechnet — eine spätere
-- Änderung der Standard-Gebühr hätte damit die gesamte Historie verschoben.
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "feeEntry" double precision;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "feeExit" double precision;

-- Hebel je Trade (nicht global): 1 = ungehebelt. Die Stückzahl in positionSize
-- enthält den Hebel bereits, daher wirkt er automatisch in Risiko und P&L mit.
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "leverage" double precision NOT NULL DEFAULT 1;

-- Backfill: exakt der Stand, den die alte Laufzeit-Rechnung geliefert hat
-- (9 € je Order bei ausgeführten Echtgeld-Trades, sonst 0). Dadurch verändert
-- sich keine einzige bestehende Kennzahl. Nur Zeilen ohne Wert werden gefüllt,
-- deshalb ist ein zweiter Lauf wirkungslos.
UPDATE "trade"
SET "feeEntry" = CASE
      WHEN "tradedWithMoney" AND "result" IN ('gewinn', 'verlust', 'breakeven') THEN 9
      ELSE 0
    END
WHERE "feeEntry" IS NULL;

UPDATE "trade"
SET "feeExit" = CASE
      WHEN "tradedWithMoney" AND "result" IN ('gewinn', 'verlust', 'breakeven') THEN 9
      ELSE 0
    END
WHERE "feeExit" IS NULL;

-- Backfill Befund 2: abgeschlossene Trades ohne Ausstiegskurs bekommen den
-- Kurs, den der bisherige Code implizit unterstellt hat (Ziel bei Gewinn,
-- Stop bei Verlust). Damit entfällt der erfundene Fallback `size * 10`.
UPDATE "trade"
SET "actualExitPrice" = "takeProfit"
WHERE "result" = 'gewinn' AND "actualExitPrice" IS NULL AND "takeProfit" IS NOT NULL;

UPDATE "trade"
SET "actualExitPrice" = "stopLoss"
WHERE "result" = 'verlust' AND "actualExitPrice" IS NULL;

-- --- Einstellungen: Währung + Standard-Gebühren ----------------------------
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'EUR';
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "defaultFeeEntry" double precision NOT NULL DEFAULT 9;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "defaultFeeExit" double precision NOT NULL DEFAULT 9;

-- --- Ein-/Auszahlungen -----------------------------------------------------
-- Ohne diese Tabelle rechnet die Rendite gegen ein fixes Startkapital und wird
-- ab der ersten Nachzahlung falsch. `amount` ist immer positiv; die Richtung
-- steckt in `kind`.
CREATE TABLE IF NOT EXISTS "cashflow" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "amount" double precision NOT NULL,
  "kind" text NOT NULL DEFAULT 'einzahlung',
  "occurredAt" timestamp NOT NULL DEFAULT now(),
  "note" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cashflow_userId_idx" ON "cashflow" ("userId", "occurredAt");
