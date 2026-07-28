-- Etappe 10 „Instrumentenkarte"
--
-- Keine Schemaänderung — die Karte rechnet ausschließlich aus dem, was schon
-- da ist (`assessment`, `trade`, `trade_event`, `quote_snapshot`). Neu ist nur
-- der Zugriffsweg: Bisher wurde `trade.stockId` fast nie zum Filtern benutzt
-- (Trades hingen an der Trade-Liste, nicht am Instrument). Die Karte dreht das
-- um und fragt je Instrument. Ohne Index wäre das ein Full Scan über `trade`
-- pro Seitenaufbau — auf vier Seiten.
--
-- `stockId` ist bewusst NULL-bar (ein Trade darf ohne verknüpftes Instrument
-- existieren, siehe `lib/link-trades.ts`); der Index deckt das mit ab.

CREATE INDEX IF NOT EXISTS "trade_stock_idx"
  ON "trade" ("stockId");

-- Dieselbe Begründung für die Prognosen: Die Karte gruppiert sie je Instrument.
CREATE INDEX IF NOT EXISTS "assessment_stock_idx"
  ON "assessment" ("stockId");
