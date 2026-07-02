-- Optionaler Chart-Link pro Instrument (z. B. TradingView), um den Chart direkt aufzurufen.
-- Additiv only (safe für bestehende Daten), idempotent.

ALTER TABLE "stock" ADD COLUMN IF NOT EXISTS "chartUrl" text;
