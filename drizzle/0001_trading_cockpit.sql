-- Trading Cockpit migration: instrument enrichment + analysis enrichment + trade table.
-- Additive only (safe for existing data). Run against the Vercel/Neon DB at deploy time:
--   DATABASE_URL=... pnpm db:push   (or apply this file manually)

-- Instrument (table name stays `stock`)
ALTER TABLE "stock" ADD COLUMN IF NOT EXISTS "market" text NOT NULL DEFAULT 'aktien';

-- Pure analysis / prediction enrichment
ALTER TABLE "assessment" ADD COLUMN IF NOT EXISTS "predictedDirection" text;
ALTER TABLE "assessment" ADD COLUMN IF NOT EXISTS "elliottCount" text;

-- Real trades (DisciplinedTrader journal + Douglas + Elliott)
CREATE TABLE IF NOT EXISTS "trade" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "stockId" integer,
  "ticker" text NOT NULL,
  "market" text NOT NULL DEFAULT 'aktien',
  "direction" text NOT NULL,
  "entryPrice" double precision NOT NULL,
  "stopLoss" double precision NOT NULL,
  "takeProfit" double precision,
  "positionSize" double precision,
  "strategy" text,
  "broker" text,
  "riskRewardRatio" double precision,
  "notes" text,
  "status" text NOT NULL DEFAULT 'geplant',
  "elliottWaveCount" text,
  "waveDegree" text,
  "elliottInvalidation" double precision,
  "preTradeAnswered" boolean NOT NULL DEFAULT false,
  "followedPlan" boolean,
  "ruleViolations" text,
  "lossAccepted" boolean NOT NULL DEFAULT false,
  "result" text,
  "actualExitPrice" double precision,
  "openedAt" timestamp,
  "closedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
