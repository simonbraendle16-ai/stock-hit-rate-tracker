-- Kapitaleinsatz + Teilverkauf-Anteil für die Geld-/Gebühren-Berechnung.
-- Additiv only (safe für bestehende Daten), idempotent.

ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "investedAmount" double precision;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "takeProfitPct" double precision DEFAULT 100;
