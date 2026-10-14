-- Preserve cTrader partial targets separately from the user's planned targets.
ALTER TABLE broker_order ADD COLUMN IF NOT EXISTS "brokerDetails" jsonb;
