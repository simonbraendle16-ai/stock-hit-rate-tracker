-- "Kein Handel" outcome: a planned setup whose entry/target zone was never reached.
-- Stores an optional reason note. Additive only (safe for existing data), idempotent.

ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "noTradeNote" text;
