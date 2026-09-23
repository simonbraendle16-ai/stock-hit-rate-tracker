-- Wiederholungsschutz und optimistische Version für API-Trades.
ALTER TABLE trade ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "externalRequestKey" text;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "externalRequestHash" text;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "externalSource" jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS trade_user_external_request_key_idx
  ON trade ("userId", "externalRequestKey");

CREATE OR REPLACE FUNCTION bump_trade_version() RETURNS trigger AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trade_version_update') THEN
    CREATE TRIGGER trade_version_update BEFORE UPDATE ON trade
      FOR EACH ROW EXECUTE FUNCTION bump_trade_version();
  END IF;
END;
$$;
