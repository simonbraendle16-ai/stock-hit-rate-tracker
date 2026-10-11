import { createHash } from "node:crypto";
import { and, eq, sql, asc, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { stock, candleCache } from "@/lib/db/schema";
import { ApiError } from "@/lib/assistant-api";
import {
  validateHistory,
  historyCoverage,
  type HistoryInput,
} from "@/lib/fibonacci-history";
const intervals: Record<string, string> = {
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
  "1M": "1month",
};
export async function saveHistory(
  userId: string,
  id: string,
  raw: HistoryInput,
) {
  let input: HistoryInput;
  try {
    input = validateHistory(raw);
  } catch (e) {
    throw new ApiError(422, (e as Error).message);
  }
  const [owned] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.id, input.stockId), eq(stock.userId, userId)));
  if (!owned) throw new ApiError(404, "Instrument nicht gefunden.");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  await db.execute(
    sql`INSERT INTO fibonacci_history(id,"userId","stockId",fingerprint,interval,timezone,currency,source,origin,candles) VALUES (${id}::uuid,${userId},${input.stockId},${fingerprint},${input.interval},${input.timezone},${input.currency},${input.source},${input.origin},${JSON.stringify(input.candles)}::jsonb) ON CONFLICT DO NOTHING`,
  );
  const found = await db.execute(
    sql`SELECT id FROM fibonacci_history WHERE "userId"=${userId} AND "stockId"=${input.stockId} AND fingerprint=${fingerprint}`,
  );
  const collision = await db.execute(
    sql`SELECT id FROM fibonacci_history WHERE id=${id}::uuid AND ("userId"<>${userId} OR "stockId"<>${input.stockId} OR fingerprint<>${fingerprint})`,
  );
  if (collision.rows.length)
    throw new ApiError(409, "Importkennung gehört zu einem anderen Datensatz.");
  if (!found.rows.length)
    throw new ApiError(409, "Importkennung bereits vergeben.");
  return getHistory(userId, String(found.rows[0].id));
}
export async function listHistory(userId: string, stockId?: number) {
  const result = await db.execute(
    sql`SELECT id,"stockId",version,interval,timezone,currency,source,origin,"createdAt",jsonb_array_length(candles) AS count,(candles->0->>'time')::bigint AS "from",(candles->-1->>'time')::bigint AS "to" FROM fibonacci_history WHERE "userId"=${userId} ${stockId ? sql`AND "stockId"=${stockId}` : sql``} ORDER BY "createdAt" DESC,id LIMIT 100`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    stockId: Number(row.stockId),
    version: Number(row.version),
    interval: String(row.interval),
    timezone: String(row.timezone),
    currency: String(row.currency),
    source: String(row.source),
    origin: String(row.origin),
    createdAt: String(row.createdAt),
    from: Number(row.from),
    to: Number(row.to),
    count: Number(row.count),
  }));
}
export async function getHistory(userId: string, id: string) {
  const result = await db.execute(
    sql`SELECT id,"stockId",version,interval,timezone,currency,source,origin,"createdAt",candles FROM fibonacci_history WHERE id=${id}::uuid AND "userId"=${userId}`,
  );
  if (!result.rows.length)
    throw new ApiError(404, "Kursdatensatz nicht gefunden.");
  const row = result.rows[0] as unknown as HistoryInput & {
    id: string;
    version: number;
  };
  return { ...row, coverage: historyCoverage(row.candles, row.interval) };
}
export async function snapshotStoredHistory(
  userId: string,
  id: string,
  meta: Omit<HistoryInput, "candles" | "origin">,
  from: number,
  to: number,
) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from > to ||
    !intervals[meta.interval]
  )
    throw new ApiError(422, "Gültigen Zeitraum und Intervall wählen.");
  const [instrument] = await db
    .select({ symbol: stock.providerSymbol })
    .from(stock)
    .where(and(eq(stock.id, meta.stockId), eq(stock.userId, userId)));
  if (!instrument?.symbol)
    throw new ApiError(
      404,
      "Kein eindeutig zugeordnetes Anbietersymbol vorhanden.",
    );
  const candles = await db
    .select({
      time: candleCache.time,
      open: candleCache.open,
      high: candleCache.high,
      low: candleCache.low,
      close: candleCache.close,
      volume: candleCache.volume,
    })
    .from(candleCache)
    .where(
      and(
        eq(candleCache.symbol, instrument.symbol),
        eq(candleCache.interval, intervals[meta.interval]),
        gte(candleCache.time, from),
        lte(candleCache.time, to),
      ),
    )
    .orderBy(asc(candleCache.time))
    .limit(20001);
  return saveHistory(userId, id, {
    ...meta,
    source: `Kerzenspeicher ${instrument.symbol}: ${meta.source}`,
    origin: "cache",
    candles,
  });
}
