-- Append-only revisions. A linked receipt prevents accidental event/history deletion.
ALTER TABLE broker_exit ADD COLUMN IF NOT EXISTS "settlementReceipt" jsonb;
CREATE TABLE IF NOT EXISTS trade_settlement_receipt (
  id serial PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "tradeId" integer NOT NULL REFERENCES trade(id) ON DELETE RESTRICT,
  "eventId" integer NOT NULL REFERENCES trade_event(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  receipt jsonb NOT NULL,
  "correctionReason" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("eventId", version)
);
CREATE INDEX IF NOT EXISTS settlement_owner_trade_idx ON trade_settlement_receipt ("userId", "tradeId");
