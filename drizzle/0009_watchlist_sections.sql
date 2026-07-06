-- Watchlist V2: benutzerdefinierte Sektionen (TradingView-Stil-Gruppen) + Sortierung.
-- Additiv only (safe für bestehende Daten), idempotent.

ALTER TABLE "stock" ADD COLUMN IF NOT EXISTS "watchlistSection" text;
ALTER TABLE "stock" ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0;
