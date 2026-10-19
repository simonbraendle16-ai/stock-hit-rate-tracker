import { DURATION_CLASSES, type ResearchEvidence, type ClassifiedDuration } from './fibonacci-catalogue';
import type { TargetZoneResidence, TargetZoneReversal } from './fibonacci-residence';

type Evidence = ResearchEvidence & {targetZoneResidence?: TargetZoneResidence | null;targetZoneReversal?: TargetZoneReversal | null};
/** Compare only explicitly identical measurement contexts; never infer a trading-day length. */
export function residenceConflict(e?: Evidence | null): string | null {
  return durationConflict(e?.durations?.residence,e?.targetZoneResidence,"historische exakte Aufenthaltsdauer");
}
export function reversalConflict(e?: Evidence | null): string | null {
  return durationConflict(e?.durations?.reversal,e?.targetZoneReversal,"exakte Dauer bis zum Wellenwendepunkt");
}
function durationConflict(d: ClassifiedDuration | null | undefined, old: TargetZoneResidence | TargetZoneReversal | null | undefined, label: string): string | null {
  if (!d || !old || d.bucket === 'unknown' || old.kind !== 'exact' || d.timeBasis === 'unknown' || d.timeBasis !== old.timeBasis || d.convention === 'unknown' || d.convention !== old.measurementConvention || JSON.stringify(d.zone) !== JSON.stringify(old.zone)) return null;
  const bucket = DURATION_CLASSES.find(([id])=>id===d.bucket);
  if (!bucket) return null;
  let value = old.value!, lo:number=bucket[2], hi:number=bucket[3];
  if (old.timeBasis === 'calendar') value *= {minute:1/60,hour:1,day:24}[old.unit];
  else if (old.unit === 'day') {
    if (lo < 24) return null;
    lo /= 24; hi /= 24;
  } else {
    if (lo >= 24) return null;
    value *= old.unit === 'minute' ? 1/60 : 1;
  }
  return value < lo || value >= hi ? `Dauerklasse und ${label} widersprechen sich im selben Messkontext.` : null;
}
