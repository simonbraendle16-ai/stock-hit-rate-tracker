-- Etappe 14 „Einstiegs-Signal", Abschnitt 1 — der Server prüft selbst und meldet sich.
--
-- AUSGANGSLAGE
-- Kurs-Alerts (0012) gibt es seit Etappe 3, geprüft wurden sie aber ausschließlich
-- im Browser: `components/alert-watcher.tsx` ruft alle fünf Minuten `checkAlerts()`
-- — und zwar nur, solange ein Tab offen ist. Wer sein Handy in der Tasche hat,
-- erfährt vom erreichten Einstieg gar nichts. Genau der Moment, für den diese App
-- gebaut ist (Plan steht, Kurs kommt, jetzt handeln oder bewusst lassen), war der
-- einzige, den sie nicht begleitet hat.
--
-- Ab hier prüft eine Cron-Route (`/api/cron/check-alerts`, extern getaktet, weil
-- Vercel-Hobby nur EINEN Lauf pro Tag zulässt) dieselben Alerts serverseitig und
-- schickt eine E-Mail über AgentMail.
--
-- WARUM `notifiedAt` UND NICHT `triggeredAt` REICHT
-- Die beiden Zeitpunkte beantworten verschiedene Fragen. `triggeredAt` heißt: Der
-- Kurs hat das Level erreicht — das ist die fachliche Wahrheit und darf sich nie
-- daran orientieren, ob eine Mail durchkam. `notifiedAt` heißt: Diese Nachricht ist
-- raus. Ohne die Trennung hätte ein Versandfehler zwei schlechte Auswege: entweder
-- den Alert nicht als ausgelöst zu markieren (dann meldet ihn die App auch nicht
-- mehr in der Oberfläche) oder ihn als erledigt zu führen (dann kommt nie eine
-- Mail). Mit zwei Spalten gilt: ausgelöst wird sofort, gesendet wird beim nächsten
-- Lauf erneut versucht, und ein zweiter Cron-Lauf schickt NIE dieselbe Mail zweimal.
--
-- MIT ZEITZONE, anders als `triggeredAt` (0012). Aus diesem Wert wird gerechnet
-- („wie lange ist das her?"), und genau daran ist Etappe 9 schon einmal gescheitert
-- (siehe 0021): Eine Spalte ohne Zeitzone speichert nur eine Wanduhrzeit und ist
-- beim Zurücklesen um den Serverversatz daneben.
--
-- WARUM EIN LAUF-PROTOKOLL
-- Der Takt kommt von einem externen Dienst, den die App nicht kontrolliert. Wird er
-- nie eingerichtet oder fällt er still aus, sieht die App fertig aus und bleibt
-- stumm — der schlimmste denkbare Zustand für ein Warnsystem. `alert_check_run`
-- trägt deshalb jeden Lauf ein, und die Einstellungen zeigen „letzter Prüflauf: vor
-- X Minuten". Gleiches Muster wie `symbol_sync_run` (0019).
--
-- KEINE RUHEZEIT. Bewusste Nutzerentscheidung: Ein Alarm um drei Uhr nachts wird
-- am Morgen gelesen, kein Grund ihn zurückzuhalten. Krypto läuft ohnehin durch.
--
-- Additiv und idempotent, mehrfach ausführbar.

-- 1) Zustellprotokoll am einzelnen Alert.
ALTER TABLE "price_alert"
  ADD COLUMN IF NOT EXISTS "notifiedAt" timestamptz;

-- Ausgelöst UND noch nicht gemeldet — genau die Zeilen, die jeder Lauf sucht.
-- Teilindex, weil die Menge im Normalfall leer ist.
CREATE INDEX IF NOT EXISTS "price_alert_pending_notify_idx"
  ON "price_alert" ("userId")
  WHERE "triggeredAt" IS NOT NULL AND "notifiedAt" IS NULL;

-- 1b) EINMALIGER BACKFILL — und der Grund dafür ist unangenehm:
-- Ohne ihn hätte der allererste scharfe Lauf jeden jemals ausgelösten Alert als
-- „noch nicht gemeldet" vorgefunden und auf einen Schlag verschickt. Statt einer
-- ersten, ruhigen Meldung käme eine Lawine über Monate alter Kursmarken — und
-- das ausgerechnet von einem System, dessen einziger Zweck es ist, im richtigen
-- Moment genau einmal zu sprechen.
--
-- Alles, was VOR dem Einbau ausgelöst hat, gilt deshalb als erledigt. Der
-- Zeitpunkt steht fest im Text und nicht als `now()`: Diese Datei wird von
-- `scripts/apply-migration.mjs` bei jedem Lauf erneut ausgeführt: Mit `now()`
-- würde sie dabei auch frisch ausgelöste, noch ungemeldete Alerts stumm
-- schalten. Ein fester Schnitt in der Vergangenheit kann das nie.
UPDATE "price_alert"
   SET "notifiedAt" = COALESCE("triggeredAt", "createdAt")
 WHERE "triggeredAt" IS NOT NULL
   AND "notifiedAt" IS NULL
   AND "triggeredAt" < timestamp '2026-08-01 19:00:00';

-- 2) Wohin gemeldet wird. `notifyEmail` bleibt leer, solange die Adresse des
--    Kontos gilt (`resolveRecipient` in `lib/notify/alert-mail.ts`) — ein Backfill würde nur
--    dieselbe Adresse ein zweites Mal speichern und beim Ändern auseinanderlaufen.
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "notifyEmail" text;

ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "notifyByEmail" boolean NOT NULL DEFAULT true;

-- 3) Protokoll der Prüfläufe.
CREATE TABLE IF NOT EXISTS "alert_check_run" (
  "id"           serial PRIMARY KEY,
  "startedAt"    timestamptz NOT NULL DEFAULT now(),
  "finishedAt"   timestamptz,
  -- cron | client — welcher Weg den Lauf angestoßen hat. Der Unterschied ist
  -- wichtig: Läuft nur noch 'client', ist der externe Cron-Job tot.
  "trigger"      text NOT NULL DEFAULT 'cron',
  "alertsOpen"   integer NOT NULL DEFAULT 0,
  "triggered"    integer NOT NULL DEFAULT 0,
  "mailsSent"    integer NOT NULL DEFAULT 0,
  "mailsFailed"  integer NOT NULL DEFAULT 0,
  "error"        text
);

CREATE INDEX IF NOT EXISTS "alert_check_run_started_idx"
  ON "alert_check_run" ("startedAt" DESC);
