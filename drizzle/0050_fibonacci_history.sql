-- User-owned research snapshots; never writes to the shared candle cache.
CREATE TABLE IF NOT EXISTS fibonacci_history (
 id uuid PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 "stockId" integer NOT NULL REFERENCES stock(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 fingerprint text NOT NULL, interval text NOT NULL, timezone text NOT NULL,
 currency text NOT NULL, source text NOT NULL, origin text NOT NULL CHECK (origin IN ('csv','cache')),
 candles jsonb NOT NULL CHECK (jsonb_typeof(candles)='array' AND jsonb_array_length(candles) BETWEEN 1 AND 20000),
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE ("userId","stockId",fingerprint)
);
CREATE INDEX IF NOT EXISTS fibonacci_history_owner_stock ON fibonacci_history("userId","stockId","createdAt");
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "stopVariants" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("stopVariants")='array' AND jsonb_array_length("stopVariants")<=20);
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "tradeId" integer;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "historyId" uuid;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fibonacci_history_fk' AND conrelid='fibonacci_observation'::regclass) THEN
 ALTER TABLE fibonacci_observation ADD CONSTRAINT fibonacci_history_fk FOREIGN KEY ("historyId") REFERENCES fibonacci_history(id) ON DELETE RESTRICT;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION fibonacci_validate_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."userId"||NEW."contextId"::text,0));
 IF EXISTS (SELECT 1 FROM fibonacci_observation o WHERE o."userId"=NEW."userId" AND o."contextId"=NEW."contextId" AND o.id<>NEW.id AND
 (o."stockId" IS DISTINCT FROM NEW."stockId" OR o.wave IS DISTINCT FROM NEW.wave OR o.degree IS DISTINCT FROM NEW.degree OR o.timeframe IS DISTINCT FROM NEW.timeframe OR o."periodFrom" IS DISTINCT FROM NEW."periodFrom" OR o."periodTo" IS DISTINCT FROM NEW."periodTo")) THEN
 RAISE EXCEPTION 'Inconsistent wave context' USING ERRCODE='23514'; END IF;
 IF NEW."tradeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trade t WHERE t.id=NEW."tradeId" AND t."userId"=NEW."userId" AND t."stockId"=NEW."stockId") THEN
 RAISE EXCEPTION 'Invalid trade ownership' USING ERRCODE='23514'; END IF;
 IF NEW."historyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fibonacci_history h WHERE h.id=NEW."historyId" AND h."userId"=NEW."userId" AND h."stockId"=NEW."stockId") THEN
 RAISE EXCEPTION 'Invalid history ownership' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fibonacci_context_trigger ON fibonacci_observation;
CREATE TRIGGER fibonacci_context_trigger BEFORE INSERT OR UPDATE ON fibonacci_observation FOR EACH ROW EXECUTE FUNCTION fibonacci_validate_context();
