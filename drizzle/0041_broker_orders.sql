-- Broker-Aufträge sind eigene Belege und können ohne vollständigen Trade-Plan vorliegen.
CREATE TABLE IF NOT EXISTS broker_order (
  id serial PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "portfolioId" integer NOT NULL REFERENCES portfolio(id),
  broker text NOT NULL DEFAULT 'avatrade',
  "brokerAccountId" text NOT NULL,
  "brokerOrderId" text NOT NULL,
  "brokerPositionId" text,
  "linkedTradeId" integer REFERENCES trade(id) ON DELETE SET NULL,
  ticker text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  "orderType" text NOT NULL CHECK ("orderType" IN ('limit', 'market', 'stop', 'other')),
  state text NOT NULL CHECK (state IN ('accepted', 'filled', 'cancelled')),
  "limitPrice" double precision,
  "executionPrice" double precision,
  quantity double precision,
  "stopLoss" double precision,
  "takeProfit" double precision,
  "placedAt" timestamp,
  "filledAt" timestamp,
  "observedAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT broker_order_positive_values CHECK (
    ("limitPrice" IS NULL OR "limitPrice" > 0) AND
    ("executionPrice" IS NULL OR "executionPrice" > 0) AND
    (quantity IS NULL OR quantity > 0) AND
    ("stopLoss" IS NULL OR "stopLoss" > 0) AND
    ("takeProfit" IS NULL OR "takeProfit" > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS broker_order_owner_account_order_idx
  ON broker_order ("userId", broker, "brokerAccountId", "brokerOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS broker_order_owner_plan_idx
  ON broker_order ("userId", "linkedTradeId");
CREATE INDEX IF NOT EXISTS broker_order_owner_portfolio_idx
  ON broker_order ("userId", "portfolioId", "placedAt");
