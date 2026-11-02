BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS app_activity (id integer PRIMARY KEY CHECK(id=1), "seenAt" timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS background_job_gate (job text PRIMARY KEY, "ranAt" timestamptz NOT NULL);
COMMIT;
