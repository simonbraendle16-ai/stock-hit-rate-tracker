-- Prepared only. Apply after verified backup/restore, before enabling
-- KNOWLEDGE_MANIFEST_REVISION=1. Source contents are never rewritten.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.trade, public.journal_entry, public.insight, public.trade_event,
  public.trade_target, public.trade_event_revision IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS public.knowledge_manifest_state (
  id integer PRIMARY KEY CHECK (id = 1),
  token text NOT NULL
);
INSERT INTO public.knowledge_manifest_state VALUES (1, gen_random_uuid()::text)
ON CONFLICT (id) DO UPDATE SET token = gen_random_uuid()::text;
CREATE TABLE IF NOT EXISTS public.knowledge_manifest_change (
  source text NOT NULL, source_id text NOT NULL, owner_id text NOT NULL,
  token text NOT NULL, PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS knowledge_manifest_change_owner ON public.knowledge_manifest_change(owner_id);

CREATE OR REPLACE FUNCTION public.knowledge_manifest_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.knowledge_manifest_change WHERE source = TG_TABLE_NAME AND source_id = OLD.id::text;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
      DELETE FROM public.knowledge_manifest_change WHERE source = TG_TABLE_NAME AND source_id = OLD.id::text;
    END IF;
    -- Different source rows never contend on one global revision row.
    INSERT INTO public.knowledge_manifest_change VALUES (TG_TABLE_NAME, NEW.id::text, NEW."userId", gen_random_uuid()::text)
    ON CONFLICT (source, source_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, token = EXCLUDED.token;
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.knowledge_manifest_truncate()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  DELETE FROM public.knowledge_manifest_change WHERE source = TG_TABLE_NAME;
  RETURN NULL;
END;
$$;

-- Rebuild only derived revision metadata under the source write locks.
DELETE FROM public.knowledge_manifest_change;
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['trade','journal_entry','insight','trade_event','trade_target','trade_event_revision'] LOOP
    EXECUTE format('INSERT INTO public.knowledge_manifest_change SELECT %L, id::text, "userId", gen_random_uuid()::text FROM public.%I', relation, relation);
    EXECUTE format('DROP TRIGGER IF EXISTS knowledge_manifest_change ON public.%I', relation);
    EXECUTE format('DROP TRIGGER IF EXISTS knowledge_manifest_clear ON public.%I', relation);
    EXECUTE format('CREATE TRIGGER knowledge_manifest_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.knowledge_manifest_touch()', relation);
    EXECUTE format('CREATE TRIGGER knowledge_manifest_clear AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.knowledge_manifest_truncate()', relation);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER knowledge_manifest_change', relation);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER knowledge_manifest_clear', relation);
  END LOOP;
END;
$$;
COMMIT;
