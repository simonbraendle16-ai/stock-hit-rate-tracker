-- Additive only; no historical values inferred from prose.
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='fibonacci_observation'::regclass AND conname='fib_evidence_object') THEN
 ALTER TABLE fibonacci_observation ADD CONSTRAINT fib_evidence_object CHECK (jsonb_typeof(evidence)='object');
 END IF;
END $$;
