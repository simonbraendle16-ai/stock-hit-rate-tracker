-- Kurs-Alerts (Etappe 3): „setzen und weggehen". Eine Tabelle je Alert-Level,
-- gegen die beim Laden der Kerzen geprüft wird, ob der Kurs es erreicht hat.
--
-- Douglas-Filter: der In-App-Alert ist ausdrücklich ein BAUEN-Feature — wer
-- einen Alert setzt, muss nicht am Chart kleben und greift dadurch nicht
-- impulsiv ein. Keine Prognose, nur ein vom Nutzer selbst gesetztes Level.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
-- Neue Tabelle, kein Eingriff in „trade" oder „stock" — die Historie bleibt
-- nachweislich unverändert.

CREATE TABLE IF NOT EXISTS "price_alert" (
  "id"          serial PRIMARY KEY,
  "userId"      text NOT NULL,
  -- Optionaler Bezug auf ein Watchlist-Instrument bzw. den auslösenden Trade.
  -- Beide dürfen null sein; das Symbol steht darunter eigenständig, damit der
  -- Kursabruf ohne Join funktioniert (ein Trade kann ohne stockId existieren).
  "stockId"     integer,
  "tradeId"     integer,
  "ticker"      text NOT NULL,
  "market"      text NOT NULL DEFAULT 'aktien',
  -- Das zu erreichende Kurslevel.
  "price"       double precision NOT NULL,
  -- Kreuzungsrichtung: 'above' = Kurs steigt bis/über das Level,
  -- 'below' = Kurs fällt bis/unter das Level.
  "direction"   text NOT NULL,
  -- Herkunft: aus dem Plan abgeleitet (einstieg|stop|ziel) oder frei (manuell).
  "kind"        text NOT NULL DEFAULT 'manuell',
  "note"        text,
  -- Solange aktiv und nicht ausgelöst, wird das Level bei jedem Kursabruf geprüft.
  "active"      boolean NOT NULL DEFAULT true,
  -- Zeitpunkt der Auslösung; null = noch nicht erreicht.
  "triggeredAt" timestamp,
  "createdAt"   timestamp NOT NULL DEFAULT now()
);

-- Nur aktive, noch nicht ausgelöste Alerts werden geprüft — der Teilindex hält
-- den Abgleich schlank, auch wenn viele erledigte Alerts liegen bleiben.
CREATE INDEX IF NOT EXISTS "price_alert_active_idx"
  ON "price_alert" ("userId") WHERE "active" AND "triggeredAt" IS NULL;

-- --- Wertebereiche absichern -----------------------------------------------
-- direction/kind sind geschlossene Listen (lib/alerts.ts). Ein Wert außerhalb
-- würde beim Abgleich stumm nie oder immer auslösen. Der Server validiert
-- bereits; die Bedingungen hier sind die zweite Linie — genau wie bei 0011.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alert_direction_check'
  ) THEN
    ALTER TABLE "price_alert" ADD CONSTRAINT "price_alert_direction_check"
      CHECK ("direction" IN ('above', 'below'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_alert_kind_check'
  ) THEN
    ALTER TABLE "price_alert" ADD CONSTRAINT "price_alert_kind_check"
      CHECK ("kind" IN ('einstieg', 'stop', 'ziel', 'manuell'));
  END IF;
END $$;
