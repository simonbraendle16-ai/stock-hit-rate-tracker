-- Analyse/Einschätzung kann jetzt "Zone nicht angelaufen" sein: neutral, weder
-- richtig noch falsch. Additive only (safe for existing data), idempotent.

ALTER TABLE "assessment" ADD COLUMN IF NOT EXISTS "zoneNotReached" boolean NOT NULL DEFAULT false;
