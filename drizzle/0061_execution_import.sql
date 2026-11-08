-- An imported execution carries no asserted original stop/target. Normal plans
-- retain both requirements; existing rows and their values are never rewritten.
ALTER TABLE trade ALTER COLUMN "stopLoss" DROP NOT NULL;
ALTER TABLE trade ALTER COLUMN "takeProfit" DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='trade_plan_or_execution_import') THEN
    ALTER TABLE trade ADD CONSTRAINT trade_plan_or_execution_import CHECK (
      ("stopLoss" IS NOT NULL AND "takeProfit" IS NOT NULL) OR
      (coalesce("externalSource"->>'kind' = 'broker_execution_import',false) AND status IN ('aktiv','abgeschlossen'))
    );
  END IF;
END $$;
