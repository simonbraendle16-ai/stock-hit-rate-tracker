-- Das Kursziel ist Pflicht — und es ist die ÄUSSERSTE Stufe, nicht die erste.
--
-- AUSGANGSLAGE
-- Seit Etappe 13 („Teilziele") galt: `trade.takeProfit` ist die abgeleitete
-- Schreibweise der ERSTEN Stufe, also der dem Einstieg nächstgelegenen. Das war
-- in sich stimmig, aber es widersprach dem, was das Feld überall sonst bedeutet.
-- Denn „Ziel" heißt in dieser App an jeder anderen Stelle: der Kurs, bei dem der
-- Plan aufgegangen ist. Konkret standen deshalb an einem realen Trade mit den
-- Stufen 200 / 190 (Short) überall 200 — im Chance-Risiko-Verhältnis, im
-- Kurs-Wecker, im Balken Stop↔Ziel und im Bot-Zwilling. Der Plan lief auf 190
-- hinaus.
--
-- Dazu kam eine zweite Lücke: `takeProfit` war NULL erlaubt. Ein Trade ohne Ziel
-- hat kein CRV, keinen Wecker am Ziel, keinen Bot-Zwilling und keinen
-- Fortschrittsbalken — all das fiel still aus statt sichtbar zu fehlen. Und die
-- Anteile der Stufen mussten nicht auf 100 % kommen; bei zwei Trades waren 25 %
-- der Position verplant, ohne dass irgendwo stand, wohin sie laufen.
--
-- DIE NEUE LESART (eine, und es ist die des Traders)
--   Das Kursziel ist Pflicht und die äußerste Stufe.
--   Teilziele sind optional und liegen davor.
--   Der nicht verteilte Rest der Position gehört dem Kursziel.
--
-- Douglas-Begründung: „Risiko ist vor dem Einstieg definiert" meint beide Enden
-- — wo der Trade falsch ist UND wo er aufgegangen ist. Ein Plan ohne Ziel ist
-- kein vordefiniertes Risiko, sondern eine offene Frage.
--
-- WAS DIESE MIGRATION TUT
-- 1. Bei Trades MIT Stufen wandert `takeProfit`/`takeProfitPct` von der ersten
--    auf die LETZTE Stufe (gemessen am Abstand zum Einstieg, exakt wie
--    `buildTargetPlan` sortiert).
-- 2. Der nicht verteilte Rest wird der letzten Stufe zugeschlagen, damit die
--    Anteile sichtbar 100 % ergeben. NUR bei Trades ohne bereits ausgeführte
--    Stufe: Eine abgerechnete Stufe ist Geschichte und wird nicht umgeschrieben.
-- 3. `takeProfit` wird NOT NULL. Zum Zeitpunkt der Migration trägt jeder der 53
--    Trades bereits einen Wert — es ist also nichts nachzutragen, die Regel wird
--    nur festgeschrieben. Der Schritt läuft bewusst zuletzt und nur, wenn
--    wirklich keine NULL mehr übrig ist; sonst bricht er die Migration ab,
--    statt still ein halbes Ergebnis zu hinterlassen.
--
-- Idempotent: Schritt 1 und 2 sind Fixpunkte (nach dem ersten Lauf ändert sich
-- nichts mehr), Schritt 3 prüft vorher, ob die Bedingung schon gilt.
--
-- VORHER/NACHHER prüfen mit:
--   node scripts/baseline-report.mjs

-- 1 + 2: Die abgeleiteten Felder auf die äußerste Stufe umstellen.
WITH letzte AS (
  SELECT DISTINCT ON (tt."tradeId")
         tt."tradeId",
         tt.id       AS ziel_id,
         tt.price    AS ziel_preis
    FROM trade_target tt
    JOIN trade t ON t.id = tt."tradeId"
   ORDER BY tt."tradeId", abs(tt.price - t."entryPrice") DESC, tt.id DESC
),
summe AS (
  SELECT "tradeId",
         sum("sharePct")                                    AS gesamt,
         count(*) FILTER (WHERE "executedAt" IS NOT NULL)    AS ausgefuehrt
    FROM trade_target
   GROUP BY "tradeId"
)
UPDATE trade_target tt
   SET "sharePct" = tt."sharePct" + (100 - s.gesamt)
  FROM letzte l
  JOIN summe s ON s."tradeId" = l."tradeId"
 WHERE tt.id = l.ziel_id
   AND s.ausgefuehrt = 0          -- abgerechnete Staffeln bleiben unberührt
   AND s.gesamt < 100;            -- schon vollständig verteilt? dann nichts tun

WITH letzte AS (
  SELECT DISTINCT ON (tt."tradeId")
         tt."tradeId",
         tt.price     AS ziel_preis,
         tt."sharePct" AS ziel_anteil
    FROM trade_target tt
    JOIN trade t ON t.id = tt."tradeId"
   ORDER BY tt."tradeId", abs(tt.price - t."entryPrice") DESC, tt.id DESC
)
UPDATE trade t
   SET "takeProfit"    = l.ziel_preis,
       "takeProfitPct" = l.ziel_anteil
  FROM letzte l
 WHERE t.id = l."tradeId"
   AND (t."takeProfit" IS DISTINCT FROM l.ziel_preis
        OR t."takeProfitPct" IS DISTINCT FROM l.ziel_anteil);

-- 3: Pflicht festschreiben — aber nur, wenn nichts dagegen spricht.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM trade WHERE "takeProfit" IS NULL) THEN
    RAISE EXCEPTION
      'Abbruch: % Trade(s) ohne Kursziel. Bitte zuerst nachtragen, dann erneut ausführen.',
      (SELECT count(*) FROM trade WHERE "takeProfit" IS NULL);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'trade' AND column_name = 'takeProfit' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "trade" ALTER COLUMN "takeProfit" SET NOT NULL;
  END IF;
END $$;
