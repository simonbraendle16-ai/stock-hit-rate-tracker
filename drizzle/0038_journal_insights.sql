-- Freie Reflexion und belegte Erkenntnisse. Kein Backfill: bestehende
-- Trade-Notizen/Stimmungswerte werden nicht als neue Journaltexte ausgegeben.
-- Additiv und idempotent. Nur auf eine vorher geprüfte Datenbank anwenden.

CREATE TABLE IF NOT EXISTS journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "tradeId" integer REFERENCES trade(id) ON DELETE SET NULL,
  "occurredAt" timestamp NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'user_note' CHECK (kind IN ('user_note', 'assistant_interpretation')),
  situation text NOT NULL,
  intention text,
  action text,
  thoughts text,
  reflection text,
  "ruleRef" text,
  "sourceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_entry_user_time_idx ON journal_entry ("userId", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS journal_entry_user_trade_idx ON journal_entry ("userId", "tradeId");

CREATE TABLE IF NOT EXISTS insight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  statement text NOT NULL,
  area text,
  status text NOT NULL DEFAULT 'hypothesis' CHECK (status IN ('hypothesis', 'supported', 'contradicted', 'discarded')),
  "evidenceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "counterEvidenceRefs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits text,
  proposal text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS insight_user_status_idx ON insight ("userId", status);
CREATE INDEX IF NOT EXISTS insight_user_updated_idx ON insight ("userId", "updatedAt" DESC);
