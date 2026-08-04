-- Replay-Trainer, zweite Ausbaustufe: eine Sitzung, viele geübte Trades.
--
-- AUSGANGSLAGE UND WARUM SIE ZU WENIG WAR
-- Eine Übung war bis hier: eine These, einmal aufdecken, eine Bewertung. Das
-- misst die ANALYSE — aber im Markt trifft man nicht eine Entscheidung, sondern
-- eine Folge davon. Wer nach dem Einstieg zusieht, wie es gegen ihn läuft, übt
-- etwas anderes als jemand, der einmal eine Richtung tippt. Genau dieser Teil
-- fehlte, und deshalb fühlte sich der Trainer nach „Formular ausfüllen" an und
-- nicht nach Handeln.
--
-- AB HIER: `training_session` ist der Replay-DURCHLAUF, darin liegen beliebig
-- viele `training_trade`. Gezählt wird künftig der Trade, nicht die Sitzung —
-- zehn Trades in einer Sitzung sind zehn Entscheidungen.
--
-- WARUM ZWEI TABELLEN UND NICHT SPALTEN AN DER SITZUNG
-- Weil es zwei verschiedene Zeitpunkte sind, und der Abstand dazwischen ist das
-- Messgerät. `training_trade.committedAt` hält fest, dass die These VOR dem
-- Aufdecken stand; `training_checkpoint` hält fest, was unterwegs entschieden
-- wurde. Läge beides in einer Zeile, ließe sich nicht mehr belegen, was zuerst
-- da war — und eine nachträglich anpassbare These misst nichts. Dieselbe
-- Überlegung wie bei `training_result` in Migration 0026.
--
-- GEMESSEN, NICHT GESCHÄTZT
-- `outcome`/`rMultiple` schreibt die App aus den Kerzen (`measureOutcome` in
-- `lib/training-trade.ts`), nicht der Nutzer nach dem Aufdecken. `rating` und
-- `errorTags` bleiben die EIGENE Einordnung — beides nebeneinander, weil ein
-- Trade sein Ziel erreichen und die Zählung trotzdem falsch gewesen sein kann.
-- Es gilt weiter „Messung schlägt Eingabe": Das Ergebnis ist nicht editierbar.
--
-- KEIN BACKFILL. Bestehende Übungen behalten ihre These und ihr `training_result`
-- und zählen in der Statistik weiter als Sitzung mit genau einem Trade — die
-- Ladefunktion setzt sie zu derselben Zeilenform zusammen. Ihre Daten werden
-- nicht angefasst und nicht kopiert; eine Kopie liefe beim ersten Ändern
-- auseinander.
--
-- Additiv und idempotent, mehrfach ausführbar.

-- Wie der Replay anhält — gewählt beim Anlegen der Sitzung.
-- 'auto'    = alle `stopEvery` Kerzen von selbst
-- 'manuell' = nur auf Knopfdruck
-- Vorgabe 'auto': Wer den Ablauf noch nicht kennt, soll zum Hinsehen kommen.
ALTER TABLE "training_session"
  ADD COLUMN IF NOT EXISTS "stopMode" text NOT NULL DEFAULT 'auto';
ALTER TABLE "training_session"
  ADD COLUMN IF NOT EXISTS "stopEvery" integer NOT NULL DEFAULT 10;
-- Wann die Sitzung beendet wurde. Das Ende bestimmt der Nutzer, nicht die App.
ALTER TABLE "training_session"
  ADD COLUMN IF NOT EXISTS "endedAt" timestamptz;

CREATE TABLE IF NOT EXISTS "training_trade" (
  "id"          serial PRIMARY KEY,
  "sessionId"   integer NOT NULL,
  "userId"      text NOT NULL,
  -- Laufende Nummer innerhalb der Sitzung (1, 2, 3 …) — die Reihenfolge, in
  -- der geübt wurde. Nicht die id: die ist global und sagt nichts über die
  -- Stelle innerhalb der Sitzung.
  "seq"         integer NOT NULL DEFAULT 1,

  -- Die These, festgeschrieben VOR dem Weiterlaufen.
  -- long | short | keine   ('keine' = bewusste Enthaltung, zählt nicht in die Quote)
  "direction"   text NOT NULL,
  "entryPrice"  double precision,
  "stopLoss"    double precision,
  "takeProfit"  double precision,
  "elliottCount" text,
  "invalidation" double precision,
  "thesisNote"  text,
  "setupTags"   text,
  -- Zeit der letzten sichtbaren Kerze beim Festschreiben. Der Beleg dafür, dass
  -- die These vor dem Ergebnis stand — und der Startpunkt der Messung.
  "entryCandleTime" integer,
  "committedAt" timestamptz NOT NULL DEFAULT now(),

  -- Das GEMESSENE Ergebnis. NULL, solange der Trade noch läuft.
  -- ziel | stop | offen
  "outcome"     text,
  "outcomeCandleTime" integer,
  "exitPrice"   double precision,
  "rMultiple"   double precision,
  -- Stop und Ziel lagen in derselben Kerze → konservativ gilt der Stop, und das
  -- wird ausgewiesen statt verschwiegen (wie beim Bot-Zwilling).
  "ambiguous"   boolean NOT NULL DEFAULT false,

  -- Die EIGENE Einordnung, nach dem Aufdecken.
  -- korrekt | teilweise | falsch
  "rating"      text,
  "errorTags"   text,
  "note"        text,
  "ratedAt"     timestamptz,

  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "training_trade_session_idx"
  ON "training_trade" ("sessionId", "seq");
CREATE INDEX IF NOT EXISTS "training_trade_user_idx"
  ON "training_trade" ("userId");

-- Was an einem Haltepunkt entschieden wurde.
--
-- Der eigentliche Wert steckt in den Zeilen OHNE Trade: Sie zählen, wie oft man
-- hingesehen und sich bewusst herausgehalten hat. Überhandeln ist der häufigste
-- Anfängerfehler, und ohne diese Zeilen wäre er nicht messbar — man sähe nur
-- die Trades, die entstanden sind, nie die, die man sich verkniffen hat.
CREATE TABLE IF NOT EXISTS "training_checkpoint" (
  "id"        serial PRIMARY KEY,
  "sessionId" integer NOT NULL,
  "userId"    text NOT NULL,
  -- NULL = zu diesem Zeitpunkt war kein Trade offen.
  "tradeId"   integer,
  -- Zeit der letzten sichtbaren Kerze am Haltepunkt.
  "candleTime" integer,
  -- kein_setup | haelt | gedreht | raus
  "decision"  text NOT NULL,
  "note"      text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "training_checkpoint_session_idx"
  ON "training_checkpoint" ("sessionId", "id");
