-- Kontrakte, Margin, Kontodeckung (Plan Demo-Handel, Teil 3)
--
-- AUSGANGSLAGE
-- Ein Trade wurde bisher über Kapitaleinsatz und Hebel bemessen: `investedAmount`
-- × `leverage` ÷ Einstiegskurs ergab die Stückzahl in `positionSize`. Für Aktien
-- und Spot-Krypto ist das richtig. Für einen Terminkontrakt ist es sinnlos — dort
-- kauft man keine Stücke für einen Betrag, sondern eine feste Anzahl Kontrakte
-- mit fester Tick-Größe, festem Tick-Wert und einem Einschuss, den der Broker
-- blockiert. Wer 2 ES mit 10 Ticks Risiko handelt, riskiert 250 $ — eine Zahl,
-- die aus Einsatz und Hebel nicht herzuleiten war.
--
-- WAS DIESE MIGRATION TUT
-- Drei Ergänzungen, alle additiv:
--
-- 1. `stock` bekommt die Spezifikation. Sie ist die HANDEINGABE, nicht die
--    Vorgabe: Die Vorgaben für ES, NQ, GC … stehen in `lib/contract-specs.ts`
--    und werden über die Kontrakt-Wurzel des Tickers gefunden. Was hier steht,
--    schlägt sie feldweise — Einschüsse ändern sich mehrmals im Jahr, und was
--    der eigene Broker verlangt, weiss nur der Nutzer. `contractsDisabled` ist
--    der Abschalter für den Fall, dass die Erkennung danebenliegt.
--
-- 2. `trade` bekommt die Kontraktzahl UND die Spezifikation eingefroren —
--    genau wie `feeEntry`/`feeExit` seit Migration 0010. Ein später geänderter
--    Einschuss darf die Historie nicht rückwirkend umschreiben.
--
--    `positionSize` bleibt dabei unangetastet die Größe, mit der die App
--    rechnet: Ein Kontrakt-Trade legt dort `Kontrakte × Multiplikator` ab
--    (Multiplikator = Tick-Wert ÷ Tick-Größe, bei ES also 50). Dadurch bleibt
--    `(Ausstieg − Einstieg) × positionSize` in `trade-stats`, `trade-events`,
--    `excursion` und `bot-twin` unverändert richtig, und der Altbestand ohne
--    Spezifikation rechnet weiter wie bisher.
--
-- 3. `portfolio` bekommt Umrechnungskurse. Die App rechnet Währungen sonst
--    NIRGENDS um, und das bleibt so — nur die Deckungsprüfung braucht sie: Ein
--    ES-Einschuss notiert in USD, das Konto in EUR. Ohne gepflegten Kurs wird
--    NICHT geprüft, und die Oberfläche sagt das. Ein 1:1-Vergleich wäre um
--    knapp zehn Prozent falsch, und eine falsche Zahl ist schlimmer als keine.
--    Bedeutung: `fxRates` ist JSON `{"USD": 0.92}` — 1 USD sind 0,92 Kontowährung.
--    `fxRatesAt` sagt, von wann der Kurs ist; ein Kurs ohne Datum ist ein Gerücht.
--
-- Additiv und idempotent, mehrfach ausführbar. Keine Zeile wird verändert:
-- Jeder bestehende Trade hat `contracts IS NULL` und rechnet damit unverändert.

-- 1) Instrument: Kontrakt-Spezifikation (Handeingabe schlägt die Vorgabe)
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractTickSize" double precision;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractTickValue" double precision;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractSize" double precision;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractCurrency" text;
-- fest | notional
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractMarginModel" text;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractInitialMargin" double precision;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractMaintenanceMargin" double precision;
-- Erhaltungssatz als Anteil des Kontraktwerts (nur beim Modell 'notional')
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractMaintenanceRate" double precision;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS "contractsDisabled" boolean NOT NULL DEFAULT false;

-- 2) Trade: Kontraktzahl + eingefrorene Spezifikation
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "contracts" double precision;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "contractTickSize" double precision;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "contractTickValue" double precision;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "contractMultiplier" double precision;
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "contractCurrency" text;
-- Der beim Eröffnen tatsächlich gebundene Einschuss ALLER Kontrakte dieses Trades.
ALTER TABLE trade ADD COLUMN IF NOT EXISTS "contractInitialMargin" double precision;

-- 3) Depot: Umrechnungskurse für die Deckungsprüfung
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS "fxRates" text;
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS "fxRatesAt" timestamp;
