-- Pro-User-Einstellungen: Startkapital & Risiko-Vorgaben.
-- Grundlage für echte Geld-Kennzahlen und den Risiko-Guard. Idempotent.

CREATE TABLE IF NOT EXISTS "user_settings" (
  "userId" text PRIMARY KEY,
  "startCapital" double precision NOT NULL DEFAULT 10000,
  "defaultRiskPct" double precision NOT NULL DEFAULT 1,
  "maxRiskPct" double precision NOT NULL DEFAULT 2
);
