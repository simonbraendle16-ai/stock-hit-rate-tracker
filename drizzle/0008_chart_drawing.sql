-- Persistente Chart-Zeichnungen (Trendlinien, Fibs, Level, Notizen) je Instrument.
-- Grundlage für AP 5 (Zeichenwerkzeuge) und AP 6 (Analyse-Import). Idempotent.

CREATE TABLE IF NOT EXISTS "chart_drawing" (
  "id" serial PRIMARY KEY,
  "userId" text NOT NULL,
  "stockId" integer NOT NULL,
  "type" text NOT NULL,
  "points" text NOT NULL,
  "style" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chart_drawing_user_stock_idx"
  ON "chart_drawing" ("userId", "stockId");
