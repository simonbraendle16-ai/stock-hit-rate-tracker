-- Additive: existing personal events and assessments are not rewritten.
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "reviewStatus" text;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "reviewDeferredUntil" timestamp;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "reviewLossAccepted" boolean;
CREATE INDEX IF NOT EXISTS trade_pending_review_idx ON trade ("userId", "reviewStatus", "reviewDeferredUntil") WHERE status = 'abgeschlossen';
CREATE TABLE IF NOT EXISTS trade_action_request (
  id serial PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id),
  "tradeId" integer NOT NULL REFERENCES trade(id) ON DELETE RESTRICT,
  "requestKey" text NOT NULL, "requestHash" text NOT NULL, response jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(), UNIQUE ("userId", "requestKey")
);
CREATE TABLE IF NOT EXISTS trade_event_revision (
  id serial PRIMARY KEY, "userId" text NOT NULL REFERENCES "user"(id),
  "tradeId" integer NOT NULL REFERENCES trade(id) ON DELETE RESTRICT,
  "eventId" integer NOT NULL REFERENCES trade_event(id) ON DELETE RESTRICT,
  version integer NOT NULL, before jsonb NOT NULL, after jsonb NOT NULL,
  reason text NOT NULL, source jsonb NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("eventId", version)
);
CREATE INDEX IF NOT EXISTS event_revision_owner_trade_idx ON trade_event_revision ("userId", "tradeId");
