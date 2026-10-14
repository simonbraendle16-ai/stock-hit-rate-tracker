-- Current provider metadata only; no historical price, FX or trade backfill.
ALTER TABLE quote_snapshot ADD COLUMN IF NOT EXISTS "marketState" text;
ALTER TABLE quote_snapshot ADD COLUMN IF NOT EXISTS "quoteType" text;
ALTER TABLE alert_check_run ADD COLUMN IF NOT EXISTS "quotesPaused" integer NOT NULL DEFAULT 0;
