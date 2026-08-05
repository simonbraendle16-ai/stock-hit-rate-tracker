-- Zeichen-Standards und wählbarer Vorlauf im Trainer.
--
-- AUSGANGSLAGE
-- Die Chart-Werkzeuge waren für echte Arbeit nicht zu gebrauchen. Zwei Gründe
-- davon brauchen eine Spalte:
--
-- (1) FIBONACCI WAR FEST VERDRAHTET. Sieben Levels standen als Konstante in
--     `components/chart/drawing-layer.tsx`. Wer mit 1,272 und 1,618 arbeitet,
--     kam nicht an sie heran; wer 0,236 nicht sehen will, wurde sie nicht los.
--     Ab hier ist die Einstellung Teil der Zeichnung (JSON in
--     `chart_drawing.style` bzw. `training_annotation.style` — dort ohne
--     Migration, weil die Spalte schon JSON trägt). Was fehlte, war der Ort für
--     den EIGENEN Standard: die Levels, mit denen jedes neue Fib beginnt.
--     Ohne ihn müsste man seine Levels bei jeder einzelnen Zeichnung neu
--     einstellen — genau die Art Reibung, die ein Werkzeug unbenutzbar macht.
--
-- (2) DER TRAINER STARTETE OHNE VORLAUF. Wie viele Kerzen vor der ersten
--     Entscheidung sichtbar sind, entschied bisher eine Formel (62 % der
--     Reihe). Aus einem Chart ohne Vergangenheit lässt sich aber nichts
--     ableiten — man rät. `training_session.leadIn` hält deshalb fest, wie viel
--     Vorlauf beim Anlegen gewählt wurde.
--
-- WARUM JSON IN EINEM TEXTFELD UND NICHT JE WERT EINE SPALTE
-- Dieselbe Entscheidung wie bei `user_settings.chartAppearance` (Migration
-- 0028): Je Einstellung eine Spalte hieße, jede weitere Einstellung ist eine
-- weitere Migration. Gelesen wird ausschließlich über `normalizeFibStil`
-- (`lib/fib-levels.ts`) und `normalizeDrawingStyle` (`lib/drawing-style.ts`) —
-- jedes Feld einzeln geprüft, Ungültiges fällt auf den Standard. Eine ältere
-- gespeicherte Einstellung bleibt nach einer Erweiterung gültig.
--
-- KEIN BACKFILL. NULL heißt „Auslieferungszustand": bei den Zeichen-Standards
-- `DEFAULT_FIB`/`DEFAULT_FIBEXT`, beim Vorlauf die bisherige Formel. Es sieht
-- also für alle unverändert aus, bis jemand etwas einstellt.
--
-- Additiv und idempotent — die Datenbank enthält echte Trades und echte Übungen.

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "drawingDefaults" text;

ALTER TABLE "training_session" ADD COLUMN IF NOT EXISTS "leadIn" integer;
