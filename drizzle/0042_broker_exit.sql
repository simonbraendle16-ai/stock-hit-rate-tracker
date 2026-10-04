CREATE TABLE IF NOT EXISTS broker_exit (
  id serial PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "portfolioId" integer NOT NULL REFERENCES portfolio(id),
  broker text NOT NULL DEFAULT 'avatrade',
  "brokerAccountId" text NOT NULL,
  "brokerPositionId" text NOT NULL,
  "brokerExitId" text NOT NULL,
  "brokerOrderId" integer REFERENCES broker_order(id) ON DELETE SET NULL,
  "linkedTradeId" integer REFERENCES trade(id) ON DELETE SET NULL,
  quantity double precision NOT NULL CHECK (quantity > 0),
  price double precision NOT NULL CHECK (price > 0),
  "exitedAt" timestamp NOT NULL,
  "observedAt" timestamp NOT NULL,
  "processedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS broker_exit_identity_idx
  ON broker_exit ("userId", broker, "brokerAccountId", "brokerExitId");
CREATE INDEX IF NOT EXISTS broker_exit_position_idx
  ON broker_exit ("userId", broker, "brokerAccountId", "brokerPositionId");
