-- Etappe 13 „Teilziele" — mehrere Take-Profits je Trade, planbar und ausführbar.
--
-- AUSGANGSLAGE
-- Am Trade stand genau EIN Ziel (`takeProfit`) und ein Verkaufsanteil dazu
-- (`takeProfitPct`, seit 0005). Wer in Stufen aussteigt — die halbe Position bei
-- 1 R, der Rest läuft — konnte das nur im Kopf oder in der Notiz planen. Der
-- Teilverkauf (0014) gab es zwar als Ereignis, aber ohne vorher festgelegtes
-- Level: Man entschied MITTEN im Trade, wie viel man bei welchem Kurs abgibt.
--
-- Genau das ist die Entscheidung, die diese App aus dem laufenden Trade
-- heraushalten soll. Ein Ausstieg in Stufen ist Douglas-konform — aber nur, wenn
-- die Stufen VOR dem Einstieg stehen. Ab hier sind sie ein Teil des Plans und
-- werden wie Einstieg und Stop vorher festgeschrieben.
--
-- WARUM EINE TABELLE UND KEINE JSON-SPALTE
-- Anders als die Setup-Tags (0016, reine Einordnung) trägt eine Zielstufe einen
-- ZUSTAND: erreicht oder nicht, zu welchem Kurs, mit welchem Ereignis verbunden.
-- Ein JSON-Feld müsste beim Ausführen gelesen, umgeschrieben und zurückgelegt
-- werden — mit dem Ereignis-Log daneben wären das zwei Wahrheiten über denselben
-- Vorgang. Die Ausführung einer Stufe IST ein `teilverkauf`-Event; die Zeile hier
-- zeigt nur darauf (`eventId`).
--
-- WARUM `trade.takeProfit` BLEIBT
-- Wie `tradedWithMoney` seit 0022 ist es ab jetzt die abgeleitete Schreibweise:
-- der Kurs der ERSTEN Stufe, geschrieben ausschließlich dort, wo auch die Stufen
-- geschrieben werden (`createTrade`, `updateTradePlan`). Damit bleiben alle
-- reinen Funktionen in lib/ (trade-stats, bot-twin, excursion, instrument-stats)
-- und jede bestehende Anzeige unverändert gültig. Ein Trade ohne Stufen-Zeilen
-- verhält sich exakt wie bisher — der gesamte Altbestand ist unberührt.
--
-- KEIN BACKFILL. Ein Alt-Trade bekommt keine erfundene Stufe; sein `takeProfit`
-- wird beim Anzeigen als eine implizite Stufe gelesen (`effectiveTargets` in
-- lib/trade-targets.ts). Additiv und idempotent, mehrfach ausführbar.

CREATE TABLE IF NOT EXISTS "trade_target" (
  "id"            serial PRIMARY KEY,
  "tradeId"       integer NOT NULL,
  -- Redundant zum Trade, aber bewusst: jede Abfrage filtert hart auf den
  -- Eigentümer, ohne dafür erst joinen zu müssen (wie bei `trade_event`, 0014).
  "userId"        text NOT NULL,
  -- 0-basiert, aufsteigend nach Abstand zum Einstieg (Stufe 1 = am nächsten).
  -- Die Reihenfolge wird beim Speichern hergestellt, nicht vom Formular erwartet.
  "sortOrder"     integer NOT NULL DEFAULT 0,
  "price"         double precision NOT NULL,
  -- Anteil der ANFANGSposition, der auf dieser Stufe abgegeben wird (0..100].
  -- Die Summe darf unter 100 bleiben: Der Rest läuft bis zur letzten Stufe.
  "sharePct"      double precision NOT NULL,
  -- Ausführung. Alle drei zusammen gesetzt oder alle drei leer.
  "executedAt"    timestamp,
  "executedPrice" double precision,
  "executedQty"   double precision,
  -- Das `teilverkauf`- bzw. `geschlossen`-Event dieser Ausführung. Die Zeile
  -- hier rechnet nichts nach — sie zeigt auf den Vorgang im Log.
  "eventId"       integer,
  "note"          text,
  "createdAt"     timestamp NOT NULL DEFAULT now()
);

-- Ein Anteil von 0 % wäre keine Stufe, über 100 % keine Position.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_target_share_check'
  ) THEN
    ALTER TABLE "trade_target"
      ADD CONSTRAINT "trade_target_share_check"
      CHECK ("sharePct" > 0 AND "sharePct" <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_target_price_check'
  ) THEN
    ALTER TABLE "trade_target"
      ADD CONSTRAINT "trade_target_price_check"
      CHECK ("price" > 0);
  END IF;
END $$;

-- Der Zugriffsweg ist immer „alle Stufen eines Trades, in Reihenfolge".
CREATE INDEX IF NOT EXISTS "trade_target_trade_idx"
  ON "trade_target" ("tradeId", "sortOrder");

CREATE INDEX IF NOT EXISTS "trade_target_user_idx"
  ON "trade_target" ("userId");

-- Zwei Stufen auf demselben Kurs wären in der Anzeige nicht auseinanderzuhalten
-- und im Chart eine Linie. Beim Speichern wird das schon abgelehnt; hier steht
-- es zusätzlich in den Daten, damit es auch ein späterer Schreibweg nicht
-- umgehen kann.
CREATE UNIQUE INDEX IF NOT EXISTS "trade_target_price_uniq"
  ON "trade_target" ("tradeId", "price");
