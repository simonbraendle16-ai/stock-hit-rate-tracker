-- Emotions-Check-in (Etappe 4): zwei Momentaufnahmen je Trade — beim Aktivieren
-- und beim Abschließen. Skala 1–5 (ruhig ↔ aufgewühlt), Tags aus der festen
-- Liste in `lib/emotions.ts`, dazu je eine optionale Notiz.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
--
-- Dateiname weicht bewusst von der Roadmap ab (dort `0013_emotions.sql`):
-- Etappe 2 und 3 sind noch nicht gebaut, 0011 ist die nächste freie Nummer.
--
-- KEIN Backfill. Für die 15 Alt-Trades gibt es keinen Zustand, den man ohne
-- Erfindung eintragen könnte — sie bleiben leer und fallen in der Auswertung
-- unter „ohne Angabe". Eine erfundene 3 wäre genau die Scheinpräzision, die
-- die Auswertung vermeiden soll.

-- --- Momentaufnahme beim Einstieg ------------------------------------------
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "moodEntry" integer;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "moodEntryTags" text;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "moodEntryNote" text;

-- --- Momentaufnahme beim Ausstieg ------------------------------------------
-- Zwei getrennte Notizfelder statt des einen `moodNote` aus der Roadmap: mit
-- einer gemeinsamen Spalte würde die Notiz vom Einstieg beim Abschließen
-- überschrieben — genau der Vergleich vorher/nachher ginge verloren.
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "moodExit" integer;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "moodExitTags" text;
ALTER TABLE "trade" ADD COLUMN IF NOT EXISTS "moodExitNote" text;

-- --- Wertebereich absichern ------------------------------------------------
-- Die Skala ist 1–5. Ein Wert außerhalb würde stumm eine leere Gruppe erzeugen
-- (moodGroupOf → null) und wäre in der Auswertung nicht mehr auffindbar.
-- Der Server validiert bereits; die Bedingung hier ist die zweite Linie.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_moodEntry_range'
  ) THEN
    ALTER TABLE "trade" ADD CONSTRAINT "trade_moodEntry_range"
      CHECK ("moodEntry" IS NULL OR ("moodEntry" BETWEEN 1 AND 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_moodExit_range'
  ) THEN
    ALTER TABLE "trade" ADD CONSTRAINT "trade_moodExit_range"
      CHECK ("moodExit" IS NULL OR ("moodExit" BETWEEN 1 AND 5));
  END IF;
END $$;
