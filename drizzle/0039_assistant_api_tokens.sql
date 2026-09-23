-- Persönliche API-Zugänge. Nur Hashes, keine Klartext-Tokens.
CREATE TABLE IF NOT EXISTS assistant_api_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  "tokenHash" text NOT NULL UNIQUE,
  scopes jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "lastUsedAt" timestamp,
  "revokedAt" timestamp
);

CREATE INDEX IF NOT EXISTS assistant_api_token_user_idx ON assistant_api_token ("userId");
