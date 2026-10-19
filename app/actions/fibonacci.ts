"use server";
import { researchResult } from "@/lib/fibonacci-research";
import { fibQuery } from "@/lib/fibonacci-query";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { stock } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { loadTradeCoverage, loadMetricSamples } from "@/lib/research-metrics-service";
import { listHistory } from "@/lib/fibonacci-history-service";
import { listFib, saveFib } from "@/lib/fibonacci-service";
import { fibStats } from "@/lib/fibonacci";
import { fibonacciReadModel } from "@/lib/fibonacci-read-model";
import { ApiError, uuidId } from "@/lib/assistant-api";
async function owner() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}
export async function getFibonacciData(stockId?: number, queryString?: string) {
  const userId = await owner();
  const [observations, instruments] = await Promise.all([
    listFib(userId, stockId),
    db
      .select({
        id: stock.id,
        name: stock.name,
        ticker: stock.ticker,
        market: stock.market,
      })
      .from(stock)
      .where(eq(stock.userId, userId))
      .orderBy(asc(stock.name)),
  ]);
  const [samples, histories, tradeCoverage] = await Promise.all([
    loadMetricSamples(userId),
    listHistory(userId, stockId),
    loadTradeCoverage(userId),
  ]);
  const request = queryString === undefined ? null : fibQuery(new URLSearchParams(queryString));
  if (request && stockId) {
    if (request.filters.stockId && request.filters.stockId !== stockId) throw new ApiError(400,"Instrumentfilter widerspricht der Instrumentseite.");
    request.filters.stockId = stockId;
  }
  const research = request ? researchResult(observations,instruments,request) : null;
  return { observations, instruments, samples, histories, tradeCoverage,
    ...(!request || research?.ready ? fibonacciReadModel(research?.selected ?? observations,tradeCoverage,samples,stockId) : {}),
    ...(request ? {research} : {}),
  };
}
export async function saveFibonacci(
  id: string,
  input: Record<string, unknown>,
  version?: number,
) {
  const userId = await owner();
  try {
    const row = await saveFib(userId, uuidId(id), input, version);
    const reread = (await listFib(userId,row.stockId)).find(r=>r.id===row.id);
    if (!reread) throw new Error("Rücklesen der Beobachtung fehlgeschlagen.");
    const coverage = fibStats([reread],reread.measurementKind).coverage;
    revalidatePath("/watchlist");
    revalidatePath("/analysis");
    revalidatePath("/tracking");
    revalidatePath(`/stock/${row.stockId}`);
    return { ok: true as const, row: reread, coverage };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false as const, error: e.message };
    throw e;
  }
}
