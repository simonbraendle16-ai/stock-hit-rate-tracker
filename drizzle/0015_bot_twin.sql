-- Bot-Zwilling (Etappe 5): von Hand nachgetragene Ausgänge.
--
-- Die Simulation selbst braucht KEINE Datenbank — sie rechnet über die Kerzen
-- der bestehenden Marktdaten-Anbindung und speichert nichts. Diese Tabelle
-- deckt genau den Fall ab, in dem der Bot nichts sagen kann: Twelve Data Free
-- liefert keine Historie mehr, der Ticker existiert nicht mehr, der Trade ist
-- zu alt. Statt solche Trades stumm auszulassen, dürfen sie von Hand ergänzt
-- werden — mit sichtbarer Kennzeichnung „nachgetragen" in der Auswertung.
--
-- Vorrang hat immer die Kursdatei: liegen für einen Trade Kerzen vor, gilt das
-- simulierte Ergebnis. Der Nachtrag bleibt erhalten und wird als ersetzt
-- ausgewiesen. Ein manueller Eintrag kann eine reale Messung nicht überstimmen.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
-- Neue Tabelle, kein Eingriff in "trade": KEIN Backfill, keine geänderte Zeile.

CREATE TABLE IF NOT EXISTS "bot_manual_outcome" (
  "id"        serial PRIMARY KEY,
  -- Bezug auf trade.id. userId steht eigenständig daneben (wie bei price_alert
  -- und trade_event), damit die Abfrage ohne Join auf "trade" auskommt.
  "tradeId"   integer NOT NULL,
  "userId"    text NOT NULL,
  -- Wie der Trade nach dem Plan geendet hätte: 'ziel' | 'stop' | 'offen'.
  -- Bei 'ziel'/'stop' ergibt sich der Kurs aus dem Plan selbst; nur 'offen'
  -- braucht einen eigenen Kurs.
  "outcome"   text NOT NULL,
  "exitPrice" double precision,
  "note"      text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Höchstens ein Nachtrag je Trade und Nutzer — sonst gäbe es zwei Wahrheiten
-- über denselben Trade.
CREATE UNIQUE INDEX IF NOT EXISTS "bot_manual_outcome_trade_idx"
  ON "bot_manual_outcome" ("tradeId", "userId");

-- --- Wertebereich absichern --------------------------------------------------
-- outcome ist eine geschlossene Liste (lib/bot-twin.ts → BotOutcome). Ein Wert
-- außerhalb würde die Differenz stumm verfälschen. Der Server validiert bereits;
-- die Bedingung hier ist die zweite Linie — genau wie bei 0011/0012/0014.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_manual_outcome_outcome_check'
  ) THEN
    ALTER TABLE "bot_manual_outcome" ADD CONSTRAINT "bot_manual_outcome_outcome_check"
      CHECK ("outcome" IN ('ziel', 'stop', 'offen'));
  END IF;
END $$;

-- Ein offener Ausgang ohne Kurs wäre kein Ergebnis, sondern eine Lücke.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bot_manual_outcome_price_check'
  ) THEN
    ALTER TABLE "bot_manual_outcome" ADD CONSTRAINT "bot_manual_outcome_price_check"
      CHECK ("outcome" <> 'offen' OR "exitPrice" IS NOT NULL);
  END IF;
END $$;
