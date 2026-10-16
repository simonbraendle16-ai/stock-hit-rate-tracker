import { AnalysisWorkspace } from "@/components/analysis-workspace";
import { getFibonacciData } from "@/app/actions/fibonacci";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getOverallStats,
  getStocksWithStats,
  getHitRateTimeline,
} from "@/app/actions/stocks";
import { CockpitHeader } from "@/components/cockpit-header";
import { QuoteAutoRefresh } from "@/components/quote-auto-refresh";
import { getInstrumentCards } from "@/app/actions/instruments";
import { getSettings } from "@/app/actions/settings";

export default async function AnalysisPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const [stats, stocks, timeline, instruments, settings, fibonacci] =
    await Promise.all([
      getOverallStats(),
      getStocksWithStats(),
      getHitRateTimeline(),
      getInstrumentCards(),
      getSettings(),
      getFibonacciData(),
    ]);

  return (
    <div className="min-h-svh">
      <CockpitHeader userLabel={session.user.name || session.user.email} />
      {/* Hält die Kurse in den Instrumentenkarten frisch, solange die Seite offen ist. */}
      <QuoteAutoRefresh />
      <AnalysisWorkspace
        fibonacci={fibonacci}
        stats={stats}
        timeline={timeline}
        stocks={stocks}
        instrumentData={instruments}
        currency={settings.currency}
      />
    </div>
  );
}
