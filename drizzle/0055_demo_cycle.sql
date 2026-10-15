-- Additive; no personal prices, FX values or events are rewritten.
ALTER TABLE candle_series ADD COLUMN IF NOT EXISTS "executionSession" jsonb;
CREATE TABLE IF NOT EXISTS demo_cycle_state (
  "portfolioId" integer PRIMARY KEY REFERENCES portfolio(id) ON DELETE CASCADE,
  "userId" text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  "nextRunAt" timestamptz NOT NULL DEFAULT now(),
  "leaseUntil" timestamptz NOT NULL DEFAULT 'epoch',
  "leaseToken" uuid,
  "cycleId" uuid,
  "cycleStartedAt" timestamptz,
  "completedAt" timestamptz,
  "lastAutomaticAt" timestamptz,
  "lastAttemptAt" timestamptz,
  phase text NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle','collect','process')),
  work jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
CREATE TABLE IF NOT EXISTS demo_cycle_tick (
  id uuid PRIMARY KEY,
  "portfolioId" integer NOT NULL REFERENCES portfolio(id) ON DELETE CASCADE,
  "userId" text NOT NULL,
  "cycleId" uuid,
  trigger text NOT NULL CHECK (trigger IN ('automatic','manual')),
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "finishedAt" timestamptz,
  outcome text NOT NULL,
  report jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS demo_cycle_tick_scope ON demo_cycle_tick("portfolioId","startedAt" DESC);
CREATE TABLE IF NOT EXISTS automatic_candle_budget (
  hour timestamptz PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 150)
);
CREATE TABLE IF NOT EXISTS automatic_candle_fetch (
  key text PRIMARY KEY,
  hour timestamptz NOT NULL,
  "leaseUntil" timestamptz NOT NULL,
  token uuid NOT NULL,
  since double precision,
  attempts integer NOT NULL DEFAULT 1,
  "attemptedAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz,
  error text
);
CREATE TABLE IF NOT EXISTS automatic_provider_day (
  provider text NOT NULL,
  day date NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 800),
  PRIMARY KEY(provider,day)
);
