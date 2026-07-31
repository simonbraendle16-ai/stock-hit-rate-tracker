-- Etappe 12 „Depots" — Echtgeld und Papierhandel strikt trennen.
--
-- AUSGANGSLAGE (der Befund, der diese Migration ausgelöst hat)
-- Am Trade stand seit 0002 ein `tradedWithMoney`. Gefiltert wurde darauf aber nur
-- bei den reinen Geldzahlen (Kontobilanz, Equity, Drawdown, Gebühren,
-- Risiko-Guard). ALLE übrigen Kennzahlen mischten Übung und Ernst:
-- Trefferquote, Erwartungswert in R, Disziplin-Score, Plan-Streak, Regelbrüche,
-- Monte-Carlo, Setup-Vergleich, Zeit-Heatmap, MAE/MFE, Bot-Zwilling,
-- Zustand & Ergebnis — und über `toFriendSummary` auch das, was Freunde sehen.
--
-- Im Bestand des Hauptnutzers war das keine Kleinigkeit, sondern der Totalschaden
-- der Auswertung: Von 20 Trades war GENAU EINER abgeschlossen (#128 XAUUSD,
-- Verlust) — und der war ein Demo-Trade. Trefferquote, Erwartungswert und
-- Disziplin-Score ruhten damit zu 100 % auf Übungsgeld. Genau die
-- Selbsttäuschung, gegen die diese App gebaut ist.
--
-- WARUM DEPOTS UND NICHT NUR EIN FILTER
-- Ein Ansichtsfilter über das bestehende Flag hätte die Zahlen sofort korrigiert,
-- aber die Ursache stehen gelassen: Die Handelsart war ein Formularfeld mit
-- Vorbelegung „Echtgeld" — ein einziger vergessener Klick, und ein Papier-Trade
-- zählt als echt. Ein Depot dagegen ist ein Ort. Man bucht IN etwas hinein, und
-- der Ort weiß, was er ist. Ab dieser Migration ist `tradedWithMoney` deshalb
-- keine Eingabe mehr, sondern die Schreibweise von `portfolio.kind` (gesetzt
-- ausschließlich in `createTrade` und `moveTrade`). Ein Papier-Trade in einem
-- Echtgeld-Depot ist strukturell unmöglich.
--
-- WARUM DIE SPALTE `tradedWithMoney` TROTZDEM BLEIBT
-- Sie ist die abgeleitete Schreibweise, nicht die Quelle. So bleiben alle reinen,
-- getesteten Funktionen in lib/ (trade-stats, trade-events, instrument-stats,
-- excursion, paper-leverage) unverändert gültig: Das Depot-Modell wirkt über die
-- AUSWAHL DER ZEILEN, nicht über neue Rechenwege. Ein Umbau der Rechenkerne wäre
-- ein zweites Risiko ohne zweiten Nutzen.
--
-- WARUM DIE TABELLE `portfolio` HEISST
-- `account` ist von Better Auth belegt (lib/db/schema.ts). In der Oberfläche
-- heißt es durchgehend „Depot".
--
-- Additiv und idempotent — mehrfach ausführbar. Kein DROP, kein RENAME, keine
-- inhaltlich geänderte Zeile. `NOT NULL` wird bewusst ERST NACH dem Backfill
-- gesetzt und nur, wenn wirklich keine Lücke mehr offen ist (siehe unten): Ein
-- Trade ohne Depot würde stumm aus jeder Auswertung fallen, und stille falsche
-- Werte sind der eine Fehler, den diese App nicht machen darf.

-- --------------------------------------------------------------------------
-- 1. Die Tabelle
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "portfolio" (
  "id"              serial PRIMARY KEY,
  "userId"          text NOT NULL,
  "name"            text NOT NULL,
  -- 'echtgeld' | 'demo' — bestimmt die Handelsart aller Trades darin.
  "kind"            text NOT NULL DEFAULT 'echtgeld',
  -- Eigenes Startkapital je Depot; beim Demo-Depot das Papier-Startkapital.
  -- Ohne diese Trennung hätte die Demo-Seite keine eigene Bilanz und keine
  -- eigene Rendite — und Prozentzahlen wären zwischen Übung und Ernst nicht
  -- vergleichbar, was der ganze Zweck des Papier-Hebels ist (Etappe 11).
  "startCapital"    double precision NOT NULL DEFAULT 10000,
  -- Vorbelegung der Ordergebühr je Depot: verschiedene Broker kosten
  -- verschieden. Beim Demo-Depot 0 — Papier kostet nichts (siehe `tradeFees`).
  "defaultFeeEntry" double precision NOT NULL DEFAULT 9,
  "defaultFeeExit"  double precision NOT NULL DEFAULT 9,
  "sortOrder"       integer NOT NULL DEFAULT 0,
  -- Stillgelegt: fällt aus Umschalter und Echtgeld-Aggregat, Historie bleibt
  -- lesbar. Ein befülltes Depot wird NIE gelöscht.
  "archivedAt"      timestamp,
  "createdAt"       timestamp NOT NULL DEFAULT now()
);

-- Wertebereich hart begrenzen — an `kind` hängt die Handelsart und damit jede
-- Geldkennzahl. Dieselbe Begründung wie bei `trade_tradeKind_check` (0018).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_kind_check'
  ) THEN
    ALTER TABLE "portfolio"
      ADD CONSTRAINT "portfolio_kind_check"
      CHECK ("kind" IN ('echtgeld', 'demo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "portfolio_user_idx"
  ON "portfolio" ("userId");

-- Zwei aktive Depots mit demselben Namen wären im Umschalter nicht
-- unterscheidbar — und ein Umschalter, bei dem man nicht weiß, wohin man bucht,
-- ist genau das Problem, das diese Migration löst. Archivierte sind ausgenommen:
-- ein stillgelegtes „Hauptdepot" darf neben einem neuen gleichen Namens stehen.
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_user_name_uniq"
  ON "portfolio" ("userId", lower("name"))
  WHERE "archivedAt" IS NULL;

-- --------------------------------------------------------------------------
-- 2. Die neuen Spalten — zunächst NULL-bar, damit der Backfill laufen kann
-- --------------------------------------------------------------------------

ALTER TABLE "trade"
  ADD COLUMN IF NOT EXISTS "portfolioId" integer;

ALTER TABLE "cashflow"
  ADD COLUMN IF NOT EXISTS "portfolioId" integer;

-- Die aktive Auswahl: 'echtgeld' = Aggregat über alle nicht archivierten
-- Echtgeld-Depots, oder 'depot:<id>' für genau eines. Bewusst in der Datenbank
-- und nicht in einem Cookie: Server-Komponenten lesen sie ohne Client-Zustand,
-- und die Auswahl überlebt den Gerätewechsel. Format und Auflösung liegen in
-- lib/portfolio-scope.ts — nicht daneben neu entscheiden.
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "activeScope" text NOT NULL DEFAULT 'echtgeld';

-- --------------------------------------------------------------------------
-- 3. Backfill: je Nutzer ein Hauptdepot und ein Demo-Depot
-- --------------------------------------------------------------------------
-- Angelegt wird für JEDEN bestehenden Nutzer, auch ohne `user_settings` und auch
-- ohne einen einzigen Demo-Trade: Der Übungsweg soll bereitstehen, BEVOR man ihn
-- braucht — sonst übt man wieder im Echtgeld-Depot. Startkapital und Gebühren
-- kommen aus den vorhandenen Einstellungen; fehlen sie, greifen die Vorgabewerte
-- der Tabelle (dieselben, die `user_settings` selbst benutzt).
--
-- Das Demo-Depot bekommt DASSELBE Startkapital wie das Hauptdepot. Grund: Nur
-- dann sind Prozentzahlen zwischen Übung und Ernst vergleichbar. Gebühren dort 0.

INSERT INTO "portfolio" ("userId", "name", "kind", "startCapital", "defaultFeeEntry", "defaultFeeExit", "sortOrder")
SELECT
  u."id",
  'Hauptdepot',
  'echtgeld',
  COALESCE(s."startCapital", 10000),
  COALESCE(s."defaultFeeEntry", 9),
  COALESCE(s."defaultFeeExit", 9),
  0
FROM "user" u
LEFT JOIN "user_settings" s ON s."userId" = u."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "portfolio" p WHERE p."userId" = u."id" AND p."kind" = 'echtgeld'
);

INSERT INTO "portfolio" ("userId", "name", "kind", "startCapital", "defaultFeeEntry", "defaultFeeExit", "sortOrder")
SELECT
  u."id",
  'Demo',
  'demo',
  COALESCE(s."startCapital", 10000),
  0,
  0,
  1
FROM "user" u
LEFT JOIN "user_settings" s ON s."userId" = u."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "portfolio" p WHERE p."userId" = u."id" AND p."kind" = 'demo'
);

-- --------------------------------------------------------------------------
-- 4. Backfill: Trades und Cashflows zuordnen
-- --------------------------------------------------------------------------
-- Verteilt wird nach dem, was der Nutzer beim Erfassen SELBST gesetzt hat
-- (`tradedWithMoney`). Hier wird nichts umgedeutet und nichts geraten — es wird
-- nur eine vorhandene Information in ihre neue Form gebracht.
--
-- `MIN(id)` ist nach Schritt 3 eindeutig (je Nutzer und Art genau ein Depot);
-- es macht die Anweisung trotzdem gegen mehrfaches Ausführen unempfindlich.

UPDATE "trade" t
SET "portfolioId" = (
  SELECT MIN(p."id") FROM "portfolio" p
  WHERE p."userId" = t."userId"
    AND p."kind" = CASE WHEN t."tradedWithMoney" THEN 'echtgeld' ELSE 'demo' END
)
WHERE t."portfolioId" IS NULL;

-- Ein- und Auszahlungen sind reales Geld und gehören ins Echtgeld-Depot.
UPDATE "cashflow" c
SET "portfolioId" = (
  SELECT MIN(p."id") FROM "portfolio" p
  WHERE p."userId" = c."userId" AND p."kind" = 'echtgeld'
)
WHERE c."portfolioId" IS NULL;

-- --------------------------------------------------------------------------
-- 5. Erst jetzt festziehen — und nur, wenn keine Lücke offen blieb
-- --------------------------------------------------------------------------
-- Ein `NOT NULL` vor dem Backfill hätte die Migration abgebrochen; ein `NOT NULL`
-- ohne diese Prüfung würde eine Lücke verschleiern. Bleibt eine Zeile ohne Depot
-- (etwa ein Trade, dessen `userId` in "user" fehlt), bricht die Migration hier
-- LAUT ab, statt die Spalte still NULL-bar zu lassen — dann fiele die Zeile
-- später unbemerkt aus jeder Auswertung.

DO $$
DECLARE
  offene_trades integer;
  offene_flows  integer;
BEGIN
  SELECT count(*) INTO offene_trades FROM "trade" WHERE "portfolioId" IS NULL;
  SELECT count(*) INTO offene_flows  FROM "cashflow" WHERE "portfolioId" IS NULL;

  IF offene_trades > 0 OR offene_flows > 0 THEN
    RAISE EXCEPTION
      'Backfill unvollstaendig: % Trades und % Cashflows ohne Depot. Ursache klaeren, NICHT NOT NULL erzwingen.',
      offene_trades, offene_flows;
  END IF;

  ALTER TABLE "trade"    ALTER COLUMN "portfolioId" SET NOT NULL;
  ALTER TABLE "cashflow" ALTER COLUMN "portfolioId" SET NOT NULL;
END $$;

-- --------------------------------------------------------------------------
-- 6. Integrität und Zugriffswege
-- --------------------------------------------------------------------------
-- Fremdschlüssel mit RESTRICT — bewusst ANDERS als bei den übrigen App-Tabellen
-- (dort steht `userId`/`stockId` ohne Referenz). Begründung: „Ein befülltes Depot
-- wird nie gelöscht, nur archiviert" ist eine Regel, die die Daten selbst
-- durchsetzen sollen und nicht nur die Serveraktion. Ein verwaister Trade hätte
-- keine Handelsart mehr — und damit keine gültige Bilanz.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_portfolio_fk'
  ) THEN
    ALTER TABLE "trade"
      ADD CONSTRAINT "trade_portfolio_fk"
      FOREIGN KEY ("portfolioId") REFERENCES "portfolio" ("id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cashflow_portfolio_fk'
  ) THEN
    ALTER TABLE "cashflow"
      ADD CONSTRAINT "cashflow_portfolio_fk"
      FOREIGN KEY ("portfolioId") REFERENCES "portfolio" ("id") ON DELETE RESTRICT;
  END IF;
END $$;

-- Jede Auswertung filtert ab jetzt zuerst über das Depot — ohne Index wäre das
-- ein Full Scan über `trade` bei jedem Seitenaufbau (dieselbe Begründung wie
-- `trade_stock_idx` in 0020).
CREATE INDEX IF NOT EXISTS "trade_portfolio_idx"
  ON "trade" ("portfolioId");

CREATE INDEX IF NOT EXISTS "cashflow_portfolio_idx"
  ON "cashflow" ("portfolioId");
