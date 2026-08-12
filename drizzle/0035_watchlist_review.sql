-- Wochenrunde durch die Watchlist: „wann zuletzt angesehen?"
--
-- AUSGANGSLAGE
-- Rund 140 Instrumente stehen in der Watchlist, und nirgends stand, wann eines
-- davon zuletzt betrachtet wurde. Was durchrutscht, rutscht unbemerkt durch —
-- das Gegenteil dessen, was diese App sonst leistet.
--
-- WAS DIESE MIGRATION TUT
-- Eine Spalte, ein Zeitstempel. Keine eigene Tabelle: Es gibt genau EINEN Wert je
-- Instrument, und eine Historie der Durchläufe ist ausdrücklich nicht gewollt.
-- Fällig ist, was länger als sieben Tage her ist — rollierend, gerechnet in
-- `lib/watchlist-review.ts`, nicht hier. Die Datenbank hält den Stand, nicht die Regel.
--
-- DER STARTWERT
-- Bestehende Zeilen werden auf `now()` gesetzt: Die Zählung beginnt mit der
-- Einführung, statt am ersten Tag 140 Symbole als überfällig auszuweisen. Die App
-- behauptet damit NICHT, sie hätte diese Instrumente beobachtet — die Watchlist
-- schreibt den Startzustand sichtbar dazu, solange er gilt.
--
-- Neue Instrumente bekommen NULL und sind sofort fällig. Auch das ist Absicht:
-- Ein frisch aufgenommener Wert ist genau der, den man ansehen will.
--
-- Additiv und idempotent, mehrfach ausführbar.

ALTER TABLE stock ADD COLUMN IF NOT EXISTS "lastReviewedAt" timestamp;

UPDATE stock SET "lastReviewedAt" = now() WHERE "lastReviewedAt" IS NULL;
