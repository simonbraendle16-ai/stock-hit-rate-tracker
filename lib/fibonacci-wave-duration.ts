import { DURATION_CLASSES, type ClassifiedDuration } from './fibonacci-catalogue';

/** Exact calendar days; half-open classes share the existing analysis boundaries. */
export function waveDurationFromDays(days: number | null | undefined): ClassifiedDuration | null {
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  const bucket = DURATION_CLASSES.find(([, , lo, hi]) => days >= lo / 24 && days < hi / 24)?.[0];
  return bucket ? { bucket, timeBasis: 'calendar', convention: 'whole_wave' } : null;
}
