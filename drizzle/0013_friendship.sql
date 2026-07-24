-- Freunde (Etappe 2): Accountability statt Copy-Trading. Ein Trading-Journal
-- wird allein geführt — und genau das ist sein Schwachpunkt: niemand sieht,
-- wenn du deine Regeln brichst. Der Wert dieser Etappe ist, dass jemand deine
-- Regelbrüche sieht, nicht dass du fremde Trades kopierst.
--
-- Douglas-Filter: Trades eines Freundes werden erst NACH Abschluss sichtbar
-- (Nachahmen unmöglich, Lernen möglich) und immer nur in R-Vielfachen —
-- niemals als echter Betrag, damit die Kontogröße verborgen bleibt. Es gibt
-- bewusst genau EINE feste Sichtbarkeitsstufe, keine Auswahl (Entscheidung
-- der Sitzung): Disziplin-Kennzahlen + abgeschlossene Trades in R.
--
-- Additiv only, idempotent — mehrfach ausführbar, kein Eingriff in bestehende
-- Tabellen. Die Trade-Historie bleibt nachweislich unverändert.

CREATE TABLE IF NOT EXISTS "friendship" (
  "id"          serial PRIMARY KEY,
  -- Wer die Einladung erstellt hat / wer sie eingelöst hat. Die Freundschaft
  -- ist gegenseitig: beide sehen einander auf derselben festen Stufe.
  "requesterId" text NOT NULL,
  "addresseeId" text NOT NULL,
  -- offen (reserviert) | angenommen (aktiv, per Code eingelöst) | abgelehnt
  "status"      text NOT NULL DEFAULT 'angenommen',
  "createdAt"   timestamp NOT NULL DEFAULT now(),
  "respondedAt" timestamp
);

-- Kein doppeltes Paar in derselben Richtung. A→B und B→A sind zwei Zeilen; die
-- Actions verhindern das Duplikat semantisch (beide Richtungen geprüft), dieser
-- Index die exakte Wiederholung.
CREATE UNIQUE INDEX IF NOT EXISTS "friendship_pair_idx"
  ON "friendship" ("requesterId", "addresseeId");

-- Nachschlagen „wer hat mich als Adressat" für die beidseitige Freundesliste.
CREATE INDEX IF NOT EXISTS "friendship_addressee_idx"
  ON "friendship" ("addresseeId");

CREATE TABLE IF NOT EXISTS "invite_code" (
  -- Der Code selbst ist der Schlüssel — über einen beliebigen Kanal
  -- weitergegeben und vom Empfänger eingelöst. Kein E-Mail-Versand nötig
  -- (lib/auth.ts hat keinen Mailer konfiguriert).
  "code"         text PRIMARY KEY,
  "userId"       text NOT NULL,
  "createdAt"    timestamp NOT NULL DEFAULT now(),
  "expiresAt"    timestamp NOT NULL,
  -- null = noch nicht eingelöst; sonst die id des einlösenden Nutzers.
  "usedByUserId" text
);

CREATE INDEX IF NOT EXISTS "invite_code_user_idx"
  ON "invite_code" ("userId");

-- --- Wertebereich absichern ------------------------------------------------
-- status ist eine geschlossene Liste. Zweite Verteidigungslinie zum Server
-- (genau wie die CHECK-Bedingungen in 0011/0012).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'friendship_status_check'
  ) THEN
    ALTER TABLE "friendship" ADD CONSTRAINT "friendship_status_check"
      CHECK ("status" IN ('offen', 'angenommen', 'abgelehnt'));
  END IF;
END $$;
