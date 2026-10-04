ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "demoCheckedAt" timestamp;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "demoBoundaryAt" timestamp;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "demoIssue" text;

CREATE TABLE IF NOT EXISTS "demo_run_state" (
  "id" text PRIMARY KEY,
  "nextRunAt" timestamptz NOT NULL,
  "leaseUntil" timestamptz NOT NULL
);
