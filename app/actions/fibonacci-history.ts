"use server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  parseHistoryCsv,
  type CsvColumns,
  type HistoryInput,
} from "@/lib/fibonacci-history";
import {
  saveHistory,
  getHistory,
  snapshotStoredHistory,
} from "@/lib/fibonacci-history-service";
import { uuidId } from "@/lib/assistant-api";
async function owner() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}
export async function importHistory(
  id: string,
  text: string,
  columns: CsvColumns,
  meta: Omit<HistoryInput, "candles" | "origin">,
) {
  const user = await owner();
  const row = await saveHistory(
    user,
    uuidId(id),
    parseHistoryCsv(text, columns, meta),
  );
  revalidatePath("/tracking");
  revalidatePath("/analysis");
  revalidatePath(`/stock/${meta.stockId}`);
  return row;
}
export async function copyStoredHistory(
  id: string,
  meta: Omit<HistoryInput, "candles" | "origin">,
  from: number,
  to: number,
) {
  const row = await snapshotStoredHistory(
    await owner(),
    uuidId(id),
    meta,
    from,
    to,
  );
  revalidatePath("/tracking");
  revalidatePath("/analysis");
  revalidatePath(`/stock/${meta.stockId}`);
  return row;
}
export async function readHistory(id: string) {
  return getHistory(await owner(), uuidId(id));
}
