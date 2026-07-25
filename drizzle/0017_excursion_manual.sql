-- MAE/MFE (Etappe 7c): von Hand nachgetragene Extremkurse.
--
-- Die Messung selbst braucht KEINE Datenbank — sie rechnet über die Kerzen der
-- bestehenden Marktdaten-Anbindung, im selben Durchlauf wie der Bot-Zwilling,
-- und speichert nichts. Diese Tabelle deckt die Fälle ab, in denen die Kerzen
-- nichts hergeben: Minutenlimit erreicht, Ticker beim Anbieter unbekannt, Trade
-- zu alt für die Historie — oder die einzige verfügbare Kerze ist länger als der
-- ganze Trade und misst damit Bewegung, in der gar keine Position offen war.
--
-- Gespeichert werden KURSE, keine R-Werte: „wie tief lief es" liest man am Chart
-- ab, das R ergibt sich daraus zwingend aus Einstieg und Stopdistanz (dieselbe
-- Logik wie "bot_manual_outcome", das auch nur den Kurs hält). Eine frei
-- getippte R-Zahl wäre eine Behauptung ohne Bezug.
--
-- Vorrang hat die Messung. Ausnahme ist genau die grobe Messung oben: was nicht
-- das Haltefenster misst, ist keine Messung dieses Trades und darf überstimmt
-- werden. Die Auswertung weist „nachgetragen" sichtbar aus.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
-- Neue Tabelle, kein Eingriff in "trade": KEIN Backfill, keine geänderte Zeile.

CREATE TABLE IF NOT EXISTS "trade_excursion" (
  "id"         serial PRIMARY KEY,
  -- Bezug auf trade.id. userId steht eigenständig daneben (wie bei price_alert,
  -- trade_event und bot_manual_outcome), damit die Abfrage ohne Join auskommt.
  "tradeId"    integer NOT NULL,
  "userId"     text NOT NULL,
  -- Tiefster Punkt gegen die Position (MAE) und höchster für sie (MFE), je als
  -- Kurs. Eine fehlende Seite gilt als „nicht über den Einstieg hinaus gelaufen".
  "worstPrice" double precision,
  "bestPrice"  double precision,
  "note"       text,
  "createdAt"  timestamp NOT NULL DEFAULT now(),
  "updatedAt"  timestamp NOT NULL DEFAULT now()
);

-- Höchstens ein Nachtrag je Trade und Nutzer — sonst gäbe es zwei Wahrheiten
-- über denselben Trade.
CREATE UNIQUE INDEX IF NOT EXISTS "trade_excursion_trade_idx"
  ON "trade_excursion" ("tradeId", "userId");

-- --- Wertebereich absichern --------------------------------------------------
-- Eine Zeile ohne jeden Kurs wäre kein Nachtrag, sondern eine leere Behauptung.
-- Der Server validiert bereits; die Bedingung hier ist die zweite Linie — genau
-- wie bei 0011/0012/0014/0015.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_excursion_price_check'
  ) THEN
    ALTER TABLE "trade_excursion" ADD CONSTRAINT "trade_excursion_price_check"
      CHECK ("worstPrice" IS NOT NULL OR "bestPrice" IS NOT NULL);
  END IF;
END $$;

-- Kurse sind positiv. Ein Tippfehler mit negativem Vorzeichen würde das
-- R-Vielfache stumm ins Absurde ziehen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_excursion_positive_check'
  ) THEN
    ALTER TABLE "trade_excursion" ADD CONSTRAINT "trade_excursion_positive_check"
      CHECK (
        ("worstPrice" IS NULL OR "worstPrice" > 0)
        AND ("bestPrice" IS NULL OR "bestPrice" > 0)
      );
  END IF;
END $$;
