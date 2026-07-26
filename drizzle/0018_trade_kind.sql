-- Zwei Erfassungswege am Trade: "langfristig" (voller Weg) und "schnell".
--
-- Ausgangslage: Jeder Trade musste bisher durch dasselbe Nadelöhr — neun
-- Douglas-Fragen als Gate, Elliott-Zählung, Setup, Begründung, Emotions-Check-in.
-- Für einen geplanten Positions-Trade ist genau das der Sinn der App. Für eine
-- Intraday-Reaktion ist es zu viel: der Trade wäre vorbei, bevor das Formular
-- ausgefüllt ist. Das Ergebnis wäre nicht mehr Disziplin, sondern ein Journal,
-- das die schnellen Trades gar nicht erst erfasst — die schlechteste aller
-- Varianten, weil dann ausgerechnet die impulsiven Trades unsichtbar bleiben.
--
-- Neu ist deshalb eine Spalte, die den gewählten Weg festhält. Sie ist die
-- Grundlage für zwei Guard-Entscheidungen (siehe lib/trade-kind.ts):
--   * "schnell" überspringt das Fragen-Gate,
--   * "schnell" macht den Emotions-Check-in freiwillig.
-- Der **Stop bleibt in beiden Wegen Pflicht** — die Risikogrenze ist kein
-- Formular-Ballast, sondern der Kern der Sache. Weggelassen wird die
-- Begründungs-Schicht, nicht das vordefinierte Risiko.
--
-- Warum eine Spalte und kein stiller Modus: Ein Trade ohne Gate muss als solcher
-- erkennbar bleiben. Sonst stünde er später neben den geprüften Trades, als wäre
-- er denselben Weg gegangen — und die Auswertung würde eine Disziplin behaupten,
-- die es an dieser Stelle nicht gab.
--
-- DEFAULT 'langfristig' für den Altbestand: Jeder bestehende Trade IST über den
-- vollen Weg entstanden (einen anderen gab es nicht). Der Vorgabewert ist hier
-- also kein erfundener Wert, sondern die Wahrheit — anders als bei 0011/0016,
-- wo bewusst nicht rückgefüllt wurde.
--
-- Additiv only (safe für bestehende Daten), idempotent — mehrfach ausführbar.
-- Kein DROP, kein RENAME, keine inhaltlich geänderte Zeile.

ALTER TABLE "trade"
  ADD COLUMN IF NOT EXISTS "tradeKind" text NOT NULL DEFAULT 'langfristig';

-- Wertebereich hart begrenzen: anders als bei den frei benannten Setup-Tags gibt
-- es hier genau zwei gültige Werte, und an ihnen hängen Guard-Entscheidungen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trade_tradeKind_check'
  ) THEN
    ALTER TABLE "trade"
      ADD CONSTRAINT "trade_tradeKind_check"
      CHECK ("tradeKind" IN ('langfristig', 'schnell'));
  END IF;
END $$;
