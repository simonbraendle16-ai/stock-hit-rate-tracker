-- Money flag + explicit pre-trade question answers.
-- Additive only (safe for existing data), idempotent.

ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "tradedWithMoney" boolean NOT NULL DEFAULT true;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "preTradeAnswers" text;
