-- Etappe 11: `quote_snapshot.fetchedAt` bekommt eine Zeitzone.
--
-- Das Problem, das dahintersteckt, war nicht sichtbar, solange niemand mit dem
-- Wert gerechnet hat: Die Spalte war `timestamp WITHOUT time zone`, beschrieben
-- aus Node mit `new Date()`. Dabei geht der Zeitzonenbezug verloren — gespeichert
-- wird eine nackte Wanduhrzeit. Beim Zurücklesen legt der Treiber wieder eine
-- Zeitzone an, und zwar nicht zwingend dieselbe. Die Folge:
--
--   quotesAgeMs() meldete 7455 s (≈ 2 h), obwohl der Kurs 4 Minuten alt war —
--   exakt der lokale UTC-Versatz des Servers.
--
-- Das blieb folgenlos, weil `refreshIfStale` nie aufgerufen wurde. Mit der
-- Selbstheilung (Etappe 11) wäre daraus ein Dauerschaden geworden: Ein Kurs
-- gilt IMMER als zwei Stunden alt, also hätte JEDE Nachfrage einen vollen
-- Anbieterlauf ausgelöst — genau das Abfragegewitter, gegen das Etappe 9
-- gebaut wurde.
--
-- `timestamptz` speichert einen Zeitpunkt statt einer Wanduhrzeit. Damit ist die
-- Differenz zu `Date.now()` korrekt, unabhängig davon, in welcher Zeitzone der
-- Server läuft (lokal CEST, auf Vercel UTC).
--
-- Die Umwandlung liest die Altbestände als UTC — dieselbe Annahme, unter der sie
-- geschrieben wurden. Ein möglicher Versatz betrifft nur historische Zeilen und
-- korrigiert sich beim nächsten Kursabruf von selbst.

ALTER TABLE "quote_snapshot"
  ALTER COLUMN "fetchedAt" TYPE timestamptz USING "fetchedAt" AT TIME ZONE 'UTC';

ALTER TABLE "quote_snapshot"
  ALTER COLUMN "fetchedAt" SET DEFAULT now();

-- Dieselbe Rechnung trifft das Lauf-Protokoll: Ohne Zeitzone ist „wie lange lief
-- der Lauf" und „wann war der letzte" nicht verlässlich auszuwerten.
ALTER TABLE "symbol_sync_run"
  ALTER COLUMN "startedAt" TYPE timestamptz USING "startedAt" AT TIME ZONE 'UTC';

ALTER TABLE "symbol_sync_run"
  ALTER COLUMN "startedAt" SET DEFAULT now();

ALTER TABLE "symbol_sync_run"
  ALTER COLUMN "finishedAt" TYPE timestamptz USING "finishedAt" AT TIME ZONE 'UTC';
