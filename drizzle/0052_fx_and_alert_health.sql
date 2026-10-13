-- Additive only. No historical trade, FX, price or result backfill.
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS "fxMode" text NOT NULL DEFAULT 'automatic';
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "fxSnapshotId" uuid;
CREATE TABLE IF NOT EXISTS fx_reference_cache (
  id text PRIMARY KEY,
  rates jsonb NOT NULL,
  "referenceAt" timestamptz NOT NULL,
  "fetchedAt" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_fx_snapshot (
  id uuid PRIMARY KEY,
  "userId" text NOT NULL,
  "portfolioId" integer NOT NULL,
  "quoteCurrency" text NOT NULL,
  "accountCurrency" text NOT NULL,
  rate double precision NOT NULL CHECK (rate > 0),
  "referenceAt" timestamptz NOT NULL,
  "fetchedAt" timestamptz NOT NULL,
  source text NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_fx_owner_idx ON plan_fx_snapshot ("userId", "portfolioId");
ALTER TABLE alert_check_run ADD COLUMN IF NOT EXISTS complete boolean NOT NULL DEFAULT false;
ALTER TABLE alert_check_run ADD COLUMN IF NOT EXISTS "quotesMissing" integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS alert_check_cron_success_idx ON alert_check_run ("finishedAt" DESC) WHERE trigger = 'cron' AND complete = true AND error IS NULL;
CREATE TABLE IF NOT EXISTS alert_check_state (
  id text PRIMARY KEY,
  cursor integer NOT NULL DEFAULT 0,
  "cycleFailed" boolean NOT NULL DEFAULT false,
  "leaseToken" uuid,
  "leaseUntil" timestamptz
);
CREATE TABLE IF NOT EXISTS alert_mail_delivery (
  id uuid PRIMARY KEY,
  "userId" text NOT NULL,
  "alertIds" jsonb NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "sentAt" timestamptz,
  error text
);
CREATE UNIQUE INDEX IF NOT EXISTS alert_mail_pending_user_idx ON alert_mail_delivery ("userId") WHERE "sentAt" IS NULL;
