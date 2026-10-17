import { revalidatePath } from 'next/cache';

/** Cache failure must never turn an already committed trade into a failed save. */
export function invalidateTradeAnalysis() {
  try {
    revalidatePath('/analysis');
    revalidatePath('/tracking');
  } catch {
    console.warn('trade.analysis.refresh_failed');
  }
}
