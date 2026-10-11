"use server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { loadInstrumentData } from "@/lib/instrument-data";
async function owner() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}
export async function getInstrumentCards() {
  return loadInstrumentData(await owner());
}
export async function getInstrumentCard(stockId: number) {
  const { cards, quotes } = await getInstrumentCards();
  return {
    card: cards.find((c) => c.stockId === stockId) ?? null,
    quote: quotes[stockId] ?? null,
  };
}
