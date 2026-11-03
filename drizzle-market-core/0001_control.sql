-- Separate operational migration, apply to A AND B before cutover; never auto-run.
CREATE TABLE IF NOT EXISTS market_data_control (
 id integer PRIMARY KEY CHECK(id=1), writable boolean NOT NULL DEFAULT true,
 generation integer NOT NULL DEFAULT 1, changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO market_data_control(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS market_migration_package (
 migration text NOT NULL, package text NOT NULL, digest text NOT NULL,
 copied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(migration,package)
);
CREATE OR REPLACE FUNCTION guard_market_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(731903);
 IF current_setting('tracker.market_migration',true) IS DISTINCT FROM 'on'
   AND NOT EXISTS (SELECT 1 FROM market_data_control WHERE id=1 AND writable) THEN
   RAISE EXCEPTION 'Marktdaten vorübergehend schreibgeschützt' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['candle_cache','candle_series','candle_collect_run'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS market_write_fence ON %I',t);
  EXECUTE format('CREATE TRIGGER market_write_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_market_write()',t);
 END LOOP;
END $$;
