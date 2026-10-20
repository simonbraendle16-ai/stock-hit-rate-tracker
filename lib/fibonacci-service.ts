import { residenceConflict, reversalConflict } from "./fibonacci-duration-compatibility";
import { hierarchyError } from "./fibonacci-hierarchy";
import { isDeepStrictEqual } from "node:util";
import { db } from "@/lib/db";
import {
  fibonacciObservation as observation,
  stock,
  trade,
} from "@/lib/db/schema";
import { and, eq, desc, sql, or } from "drizzle-orm";
import { ApiError } from "@/lib/assistant-api";
import {
  FibonacciError,
  validateFibInput,
  type FibObservation,
} from "@/lib/fibonacci";
export function fibValues(raw: Record<string, unknown>) {
  try {
    return validateFibInput(raw);
  } catch (e) {
    if (e instanceof FibonacciError) throw new ApiError(422, e.message);
    throw e;
  }
}
export async function listFib(
  userId: string,
  stockId?: number,
): Promise<FibObservation[]> {
  const rows = await db
    .select({
      observation,
      ticker: stock.ticker,
      name: stock.name,
      market: stock.market,
    })
    .from(observation)
    .innerJoin(
      stock,
      and(eq(stock.id, observation.stockId), eq(stock.userId, userId)),
    )
    .where(
      and(
        eq(observation.userId, userId),
        stockId ? eq(observation.stockId, stockId) : undefined,
      ),
    )
    .orderBy(
      desc(observation.observedOn),
      desc(observation.createdAt),
      desc(observation.id),
    );
  return rows.map(({ observation: row, ...instrument }) => {
    const { userId: _, createdAt: __, updatedAt: ___, ...data } = row;
    return { ...data, ...instrument };
  });
}
export async function getFib(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(observation)
    .where(and(eq(observation.id, id), eq(observation.userId, userId)));
  if (!row) throw new ApiError(404, "Beobachtung nicht gefunden.");
  const { userId: _, ...result } = row;
  return result;
}
export async function saveFib(
  userId: string,
  id: string,
  raw: Record<string, unknown>,
  version?: number,
) {
  let merged = raw;
  let previousDurationPair: unknown;
  let previousReversalPair: unknown;
  if (version !== undefined) {
    const previous = await getFib(userId, id);
    previousDurationPair = [previous.evidence?.durations?.residence, previous.evidence?.targetZoneResidence];
    previousReversalPair = [previous.evidence?.durations?.reversal, previous.evidence?.targetZoneReversal];
    // Legacy full-replacement clients keep new metadata they do not know about.
    const extended = [
      "evidence",
      "measurementKind",
      "measurementBasis",
      "contextId",
      "sourceKey",
      "sourceRef",
      "periodFrom",
      "periodTo",
      "structure",
      "target",
      "stopDescription",
      "tradability",
      "hypotheticalOutcome",
      "actualOutcome",
      "tradeId",
      "historyId",
      "stopVariants",
    ] as const;
    merged = { ...raw };
    for (const key of extended) if (!(key in raw)) merged[key] = previous[key];
    if (raw.evidence === null && previous.evidence?.targetZoneResidence) {
      throw new ApiError(422, "Gespeicherte Zielzonen-Verweildauer erhalten oder mit evidence.targetZoneResidence: null ausdrücklich entfernen; evidence: null würde sie unbeabsichtigt löschen.");
    }
    // Preserve extensions omitted by older full-replacement clients; null explicitly clears a key.
    const newKeys = ["subdivision", "subdivisionConfidence", "waveVariant", "keyFibLevel", "parentId", "historicalTime", "targetZoneResidence", "targetZoneReversal", "catalogueVersion", "structureCode", "entryZone", "targetContact", "expectationTiming", "reversalLocation", "reversalPrecision", "durations"] as const;
    if (raw.evidence === null && newKeys.some(key => previous.evidence?.[key] != null)) {
      throw new ApiError(422, "Strukturierte Angaben ausdrücklich einzeln löschen; evidence:null würde gespeicherte Daten verlieren.");
    }
    if (raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence)) {
      const next = (previous.evidence?.catalogueVersion === 1 ? {...previous.evidence,...raw.evidence} : {...raw.evidence}) as Record<string,unknown>;
      for (const key of newKeys) if (!(key in next) && previous.evidence?.[key] !== undefined) next[key] = previous.evidence[key];
      if (next.durations && typeof next.durations === "object" && !Array.isArray(next.durations)) next.durations = {...previous.evidence?.durations,...next.durations};
      merged.evidence = next;
    }
    if (merged.contextId !== previous.contextId)
      throw new ApiError(
        409,
        "Wellenkontext ist stabil; die vorhandene Kennung verwenden.",
      );
  }
  const validated = fibValues(merged);
  const durationConflict = residenceConflict(validated.evidence);
  if (durationConflict && !isDeepStrictEqual(previousDurationPair,[validated.evidence?.durations?.residence,validated.evidence?.targetZoneResidence])) throw new ApiError(422,durationConflict);
  const pivotConflict = reversalConflict(validated.evidence);
  if (pivotConflict && !isDeepStrictEqual(previousReversalPair,[validated.evidence?.durations?.reversal,validated.evidence?.targetZoneReversal])) throw new ApiError(422,pivotConflict);
  if (version === undefined && (validated.timeframe === "unbekannt" || !["long","short"].includes(validated.evidence?.waveDirection ?? ""))) {
    const existing = await db.select({id:observation.id}).from(observation).where(and(eq(observation.id,id),eq(observation.userId,userId)));
    if (!existing.length) throw new ApiError(422,"Für neue Beobachtungen Richtung und Timeframe auswählen.");
  }
  const values = { ...validated, contextId: validated.contextId ?? id };
  const [owned] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.id, values.stockId), eq(stock.userId, userId)));
  if (!owned) throw new ApiError(404, "Instrument nicht gefunden.");
  if (values.tradeId) {
    const [linked] = await db
      .select({ id: trade.id })
      .from(trade)
      .where(
        and(
          eq(trade.id, values.tradeId),
          eq(trade.userId, userId),
          eq(trade.stockId, values.stockId),
        ),
      );
    if (!linked) throw new ApiError(404, "Passender Trade nicht gefunden.");
  }
  if (values.historyId) {
    const linked = await db.execute(
      sql`SELECT id FROM fibonacci_history WHERE id=${values.historyId}::uuid AND "userId"=${userId} AND "stockId"=${values.stockId}`,
    );
    if (!linked.rows.length)
      throw new ApiError(404, "Passender Kursdatensatz nicht gefunden.");
  }
  const peers = await listFib(userId);
  const hierarchyIssue = hierarchyError(peers, {...values,id,version:version ?? 1,ticker:"",name:"",market:""});
  if (hierarchyIssue) throw new ApiError(422,hierarchyIssue);
  if (
    version === undefined &&
    !validated.contextId &&
    values.periodFrom &&
    values.periodTo &&
    values.degree !== "unbekannt" &&
    values.timeframe !== "unbekannt"
  ) {
    const matches = peers.filter(
      (r) =>
        r.stockId === values.stockId &&
        r.wave === values.wave &&
        r.degree === values.degree &&
        r.timeframe === values.timeframe &&
        r.periodFrom === values.periodFrom &&
        r.periodTo === values.periodTo,
    );
    const ids = [...new Set(matches.map((r) => r.contextId ?? r.id))];
    if (ids.length > 1)
      throw new ApiError(
        409,
        "Mehrere passende Wellenkontexte. Vorhandene Kontext-ID gezielt wählen.",
      );
    if (ids.length === 1) values.contextId = ids[0];
  }
  const context = peers.filter(
    (r) => r.contextId === values.contextId && r.id !== id,
  );
  if (
    context.some(
      (r) =>
        r.stockId !== values.stockId ||
        r.wave !== values.wave ||
        r.degree !== values.degree ||
        r.timeframe !== values.timeframe ||
        r.periodFrom !== values.periodFrom ||
        r.periodTo !== values.periodTo,
    )
  )
    throw new ApiError(
      409,
      "Wellenkontext gehört zu anderen Instrument-/Wellenangaben.",
    );
  if (version !== undefined) {
    if (!Number.isSafeInteger(version) || version < 1)
      throw new ApiError(400, "Gültige Version erforderlich.");
    const [row] = await db
      .update(observation)
      .set({
        ...values,
        version: sql`${observation.version}+1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(observation.id, id),
          eq(observation.userId, userId),
          eq(observation.version, version),
        ),
      )
      .returning();
    if (!row) {
      await getFib(userId, id);
      throw new ApiError(
        409,
        "Beobachtung wurde inzwischen geändert. Neu laden.",
      );
    }
  } else {
    const [inserted] = await db
      .insert(observation)
      .values({ ...values, id, userId })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      const [match] = await db
        .select({ id: observation.id })
        .from(observation)
        .where(
          and(
            eq(observation.userId, userId),
            or(
              eq(observation.id, id),
              and(
                eq(observation.measurementKind, values.measurementKind!),
                or(
                  eq(observation.contextId, values.contextId!),
                  values.sourceKey
                    ? eq(observation.sourceKey, values.sourceKey)
                    : undefined,
                ),
              ),
            ),
          ),
        );
      if (!match)
        throw new ApiError(409, "Erfassungskennung bereits vergeben.");
      const existing = await getFib(userId, match.id);
      if (
        Object.entries(values).some(
          ([key, value]) =>
            key !== "contextId" &&
            ((key === "stopVariants" || key === "evidence")
              ? !isDeepStrictEqual(existing[key] ?? (key === "evidence" ? {} : []), value)
              : existing[key as keyof typeof existing] !== value),
        )
      )
        throw new ApiError(
          409,
          "Diese Erfassungs-ID oder Quelle gehört zu einer anderen Beobachtung. Vorhandene Kennung und Version zur Korrektur verwenden.",
        );
      return existing;
    }
  }
  return getFib(userId, id);
}

export async function getFibRevisions(userId: string, id: string) {
  await getFib(userId, id);
  const result = await db.execute(
    sql`SELECT version,snapshot- 'userId' AS snapshot,"recordedAt" FROM fibonacci_revision WHERE "observationId"=${id}::uuid ORDER BY version DESC`,
  );
  return result.rows;
}
