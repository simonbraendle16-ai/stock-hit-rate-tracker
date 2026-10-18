-- Additive validation only; existing observation contents are never rewritten.
CREATE OR REPLACE FUNCTION fibonacci_validate_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
 -- Serialize all hierarchy changes for one owner, including changes to parents.
 PERFORM pg_advisory_xact_lock(hashtextextended('fibonacci-hierarchy:'||NEW."userId",0));
 IF NEW.evidence->>'parentId' IS NOT NULL THEN
  parent_id := (NEW.evidence->>'parentId')::uuid;
  IF parent_id=NEW.id OR NOT EXISTS (
   SELECT 1 FROM fibonacci_observation p WHERE p.id=parent_id AND p."userId"=NEW."userId" AND p."stockId"=NEW."stockId"
  ) THEN RAISE EXCEPTION 'Invalid parent observation' USING ERRCODE='23514'; END IF;
  IF EXISTS (
   WITH RECURSIVE ancestors AS (
    SELECT id,evidence FROM fibonacci_observation WHERE id=parent_id AND "userId"=NEW."userId"
    UNION
    SELECT p.id,p.evidence FROM fibonacci_observation p JOIN ancestors a ON p.id=(a.evidence->>'parentId')::uuid WHERE p."userId"=NEW."userId"
   ) SELECT 1 FROM ancestors WHERE id=NEW.id
  ) THEN RAISE EXCEPTION 'Cyclic wave hierarchy' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS (SELECT 1 FROM fibonacci_observation c WHERE c.evidence->>'parentId'=NEW.id::text AND (c."userId"<>NEW."userId" OR c."stockId"<>NEW."stockId")) THEN
  RAISE EXCEPTION 'Parent instrument/owner mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fibonacci_hierarchy_trigger ON fibonacci_observation;
CREATE TRIGGER fibonacci_hierarchy_trigger BEFORE INSERT OR UPDATE ON fibonacci_observation FOR EACH ROW EXECUTE FUNCTION fibonacci_validate_hierarchy();
