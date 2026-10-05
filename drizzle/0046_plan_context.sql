-- Additive: historical answers and assessments remain unchanged.
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "planContext" jsonb;
