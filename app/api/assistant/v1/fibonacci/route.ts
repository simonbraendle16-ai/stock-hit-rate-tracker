import { loadMetricSamples } from "@/lib/research-metrics-service";
import { researchMetrics } from "@/lib/research-metrics";
import { fibQuery } from "@/lib/fibonacci-query";
import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  apiResponseError,
  requireApiScope,
  readJsonObject,
  requestKey,
} from "@/lib/assistant-api";
import { listFib, saveFib } from "@/lib/fibonacci-service";
import {
  filterFib,
  fibStats,
  FIB_WAVES,
  FIB_DEGREES,
  FIB_TIMEFRAMES,
} from "@/lib/fibonacci";
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, "trades:read"),
      p = req.nextUrl.searchParams;
    const { filters, limit, offset } = fibQuery(p);
    const items = filterFib(await listFib(userId, filters.stockId), filters);
    return NextResponse.json({
      items: items.slice(offset, offset + limit),
      total: items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null,
      metrics: researchMetrics(
        await loadMetricSamples(userId, [
          ...new Set(
            items.flatMap((r) =>
              r.status === "abgeschlossen" && r.tradeId ? [r.tradeId] : [],
            ),
          ),
        ]),
      ),
      basis: {
        filters,
        waves: "Abgeschlossene gültige Messungen je Kontext und Messart",
        trades: "Eindeutig verknüpfte abgeschlossene Trades, jeweils einmal",
      },
      stats: fibStats(items, filters.measurementKind),
      statsByKind: {
        retracement: fibStats(items, "retracement"),
        expansion: fibStats(items, "expansion"),
      },
    });
  } catch (e) {
    return apiResponseError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const owner = await requireApiScope(req, "trades:write");
    return NextResponse.json(
      await saveFib(owner, requestKey(req), await readJsonObject(req)),
      { status: 201 },
    );
  } catch (e) {
    return apiResponseError(e);
  }
}
