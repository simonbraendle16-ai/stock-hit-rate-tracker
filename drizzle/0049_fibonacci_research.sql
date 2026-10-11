-- Additive upgrade; existing identities and measurements are preserved.
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "measurementKind" text NOT NULL DEFAULT 'retracement';
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "measurementBasis" text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "contextId" uuid;
UPDATE fibonacci_observation SET "contextId" = id WHERE "contextId" IS NULL;
ALTER TABLE fibonacci_observation ALTER COLUMN "contextId" SET NOT NULL;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "sourceKey" text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "sourceRef" text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "periodFrom" text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "periodTo" text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS structure text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS target double precision;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "stopDescription" text;
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS tradability text NOT NULL DEFAULT 'unbekannt';
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "hypotheticalOutcome" text NOT NULL DEFAULT 'unbekannt';
ALTER TABLE fibonacci_observation ADD COLUMN IF NOT EXISTS "actualOutcome" text NOT NULL DEFAULT 'unbekannt';
ALTER TABLE fibonacci_observation ALTER COLUMN percent DROP NOT NULL;
-- Remove the old checks by definition rather than relying on generated names.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='fibonacci_observation'::regclass AND contype='c' AND conname IN ('fibonacci_observation_wave_check','fibonacci_observation_degree_check','fibonacci_observation_timeframe_check','fibonacci_observation_observedOn_check','fibonacci_observation_status_check','fibonacci_observation_percent_check','fibonacci_observation_note_check','fibonacci_observation_version_check','fibonacci_observation_check','fib_wave','fib_degree','fib_timeframe','fib_date','fib_status','fib_kind','fib_percent','fib_expansion','fib_anchors','fib_note','fib_version','fib_period','fib_target','fib_texts','fib_tradability','fib_outcomes')
 LOOP EXECUTE format('ALTER TABLE fibonacci_observation DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE fibonacci_observation
 ADD CONSTRAINT fib_wave CHECK (length(trim(wave)) BETWEEN 1 AND 40),
 ADD CONSTRAINT fib_degree CHECK (degree IN ('GrandSupercycle','Supercycle','Zyklus','Primär','Intermediär','Minor','Minute','Minuette','Subminuette','unbekannt')),
 ADD CONSTRAINT fib_timeframe CHECK (timeframe IN ('5m','15m','30m','1h','4h','1d','1w','1M','unbekannt')),
 ADD CONSTRAINT fib_date CHECK ("observedOn" ~ '^\d{4}-\d{2}-\d{2}$' AND "observedOn"=to_char("observedOn"::date,'YYYY-MM-DD')),
 ADD CONSTRAINT fib_status CHECK (status IN ('laufend','abgeschlossen','unklar','ungueltig')),
 ADD CONSTRAINT fib_kind CHECK ("measurementKind" IN ('retracement','expansion')),
 ADD CONSTRAINT fib_percent CHECK (percent IS NULL OR (percent>=0 AND percent<'Infinity'::double precision AND ("measurementKind"='expansion' OR percent<=500))),
 ADD CONSTRAINT fib_expansion CHECK ("measurementKind"<>'expansion' OR length(trim(coalesce("measurementBasis",''))) BETWEEN 1 AND 2000),
 ADD CONSTRAINT fib_anchors CHECK (("anchorStart" IS NULL AND "anchorEnd" IS NULL AND extreme IS NULL) OR ("measurementKind"='retracement' AND percent IS NOT NULL AND "anchorStart" IS NOT NULL AND "anchorEnd" IS NOT NULL AND extreme IS NOT NULL AND "anchorStart">0 AND "anchorEnd">0 AND extreme>0 AND "anchorStart"<'Infinity'::double precision AND "anchorEnd"<'Infinity'::double precision AND extreme<'Infinity'::double precision AND "anchorStart"<>"anchorEnd" AND abs(percent-("anchorEnd"-extreme)/("anchorEnd"-"anchorStart")*100)<=0.01)),
 ADD CONSTRAINT fib_note CHECK (length(trim(note)) BETWEEN 1 AND 2000),
 ADD CONSTRAINT fib_version CHECK (version>0),
 ADD CONSTRAINT fib_period CHECK (("periodFrom" IS NULL OR ("periodFrom" ~ '^\d{4}-\d{2}-\d{2}$' AND "periodFrom"=to_char("periodFrom"::date,'YYYY-MM-DD'))) AND ("periodTo" IS NULL OR ("periodTo" ~ '^\d{4}-\d{2}-\d{2}$' AND "periodTo"=to_char("periodTo"::date,'YYYY-MM-DD'))) AND ("periodFrom" IS NULL OR "periodTo" IS NULL OR "periodFrom"<="periodTo")),
 ADD CONSTRAINT fib_target CHECK (target IS NULL OR (target>0 AND target<'Infinity'::double precision)),
 ADD CONSTRAINT fib_texts CHECK (("sourceKey" IS NULL OR length(trim("sourceKey")) BETWEEN 1 AND 200) AND ("sourceRef" IS NULL OR length(trim("sourceRef")) BETWEEN 1 AND 2000) AND (structure IS NULL OR length(trim(structure)) BETWEEN 1 AND 200) AND ("stopDescription" IS NULL OR length(trim("stopDescription")) BETWEEN 1 AND 2000) AND ("measurementBasis" IS NULL OR length(trim("measurementBasis")) BETWEEN 1 AND 2000)),
 ADD CONSTRAINT fib_tradability CHECK (tradability IN ('unbekannt','handelbar','nicht_handelbar')),
 ADD CONSTRAINT fib_outcomes CHECK ("hypotheticalOutcome" IN ('unbekannt','gewinn','verlust','breakeven','ausgelassen') AND "actualOutcome" IN ('unbekannt','gewinn','verlust','breakeven','ausgelassen'));
CREATE UNIQUE INDEX IF NOT EXISTS fibonacci_context_kind ON fibonacci_observation ("userId","contextId","measurementKind");
CREATE UNIQUE INDEX IF NOT EXISTS fibonacci_source_kind ON fibonacci_observation ("userId","sourceKey","measurementKind") WHERE "sourceKey" IS NOT NULL;
CREATE TABLE IF NOT EXISTS fibonacci_revision (
 "observationId" uuid NOT NULL REFERENCES fibonacci_observation(id) ON DELETE CASCADE,
 version integer NOT NULL, snapshot jsonb NOT NULL, "recordedAt" timestamp NOT NULL DEFAULT now(),
 PRIMARY KEY ("observationId",version)
);
INSERT INTO fibonacci_revision ("observationId",version,snapshot) SELECT id,version,to_jsonb(f) FROM fibonacci_observation f ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION fibonacci_record_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO fibonacci_revision ("observationId",version,snapshot) VALUES (NEW.id,NEW.version,to_jsonb(NEW));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fibonacci_revision_trigger ON fibonacci_observation;
CREATE TRIGGER fibonacci_revision_trigger AFTER INSERT OR UPDATE ON fibonacci_observation FOR EACH ROW EXECUTE FUNCTION fibonacci_record_revision();
