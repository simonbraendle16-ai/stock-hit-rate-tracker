-- Additive metadata; never relabel or recalculate historical trades automatically.
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "quoteCurrency" text;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "accountCurrency" text;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "quoteToAccountRate" double precision;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "fxRateAt" timestamp;
