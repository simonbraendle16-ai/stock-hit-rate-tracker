import type { FibEvidence } from "./fibonacci";
import { dateEnvelope, type TimeBoundary } from "./fibonacci-time";

/** UI defaults only. API clients and existing observations keep their semantics. */
export function newEntryEvidence(): FibEvidence {
  return { catalogueVersion: 1, subdivisionConfidence: "bestaetigt", structureConfidence: "bestaetigt", provenance: "Direkte Formulareingabe des Nutzers" };
}

export function entryEvidence(evidence: FibEvidence, isNew: boolean): FibEvidence {
  if (!isNew) return evidence;
  const result = { ...evidence };
  if (!result.structureCode || result.structureCode === "unknown") delete result.structureConfidence;
  if (!result.subdivision || result.subdivision === "unknown") delete result.subdivisionConfidence;
  return result;
}

/** Parse only complete, unambiguous dates. Never add a missing month or day. */
export function parseEntryDate(text: string): TimeBoundary | null {
  const raw = text.trim();
  if (!raw) return null;
  let date = raw;
  const german = /^(\d{1,2})\.(?:(\d{1,2})\.)?(\d{4})$/.exec(raw);
  if (german) date = german[3] + "-" + (german[2] ?? german[1]).padStart(2,"0") + (german[2] ? "-" + german[1].padStart(2,"0") : "");
  dateEnvelope(date);
  return { date, precision: date.length === 4 ? "year" : date.length === 7 ? "month" : "day" };
}

export function replaceEntryDate(previous: TimeBoundary | null, text: string): TimeBoundary | null {
  const parsed = parseEntryDate(text);
  // Formatting-only changes must not erase historical uncertainty or bounds.
  return parsed && previous?.date === parsed.date ? previous : parsed;
}
