import { TradeAnalysis } from "@/components/trade-analysis";
import { AnalysisAutoRefresh } from "@/components/analysis-auto-refresh";
import type { ComponentProps } from "react";
import { FibonacciPanel } from "@/components/fibonacci-panel";
import { StatCards } from "@/components/stat-cards";
import { DistributionChart } from "@/components/distribution-chart";
import { DistributionBarChart } from "@/components/distribution-bar-chart";
import { HitRateTimeline } from "@/components/hitrate-timeline";
import { InstrumentCardGrid } from "@/components/instrument-card-grid";
import { SectionLabel } from "@/components/section-label";
import { AddStockDialog } from "@/components/add-stock-dialog";

type Props = {
  fibonacci: ComponentProps<typeof FibonacciPanel>;
  stats: ComponentProps<typeof StatCards>["stats"];
  timeline: ComponentProps<typeof HitRateTimeline>["data"];
  stocks: ComponentProps<typeof InstrumentCardGrid>["stocks"];
  instrumentData: Pick<
    ComponentProps<typeof InstrumentCardGrid>,
    "cards" | "quotes"
  >;
  currency: string;
};

/** Shared visible workspace: authenticated page supplies owned data. */
export function AnalysisWorkspace({
  fibonacci,
  stats,
  timeline,
  stocks,
  instrumentData,
  currency,
}: Props) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <AnalysisAutoRefresh />
      <p className="eyebrow mb-3">Analyse & Forschung</p>
      <nav
        aria-label="Analysebereiche"
        className="mb-8 flex flex-wrap gap-x-5 gap-y-3 border-b border-border pb-4 font-mono text-xs"
      >
        <a
          href="#fibonacci"
          className="text-primary underline-offset-4 hover:underline"
        >
          01 · Wellenforschung
        </a>
        <a href="#trades" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">02 · Trades</a>
        <a
          href="#prognosen"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          03 · Prognosen
        </a>
        <a
          href="#instrumente"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          04 · Instrumente
        </a>
      </nav>
      <FibonacciPanel {...fibonacci} />

      <section id="trades" aria-label="Trade-Auswertung" className="mt-10 scroll-mt-36 border-t border-border pt-8">
        <TradeAnalysis rows={fibonacci.tradeCoverage ?? []} samples={fibonacci.samples ?? []} />
      </section>

      <section
        id="prognosen"
        aria-label="Prognoseauswertung"
        className="mt-10 scroll-mt-36 border-t border-border pt-8"
      >
        <SectionLabel>Prognosen · eigene Bewertungen</SectionLabel>
        <p className="mb-5 text-sm text-muted-foreground">
          Bewertete Prognosen über deine Instrumente. Die Messfilter der
          Wellenforschung gelten für diesen Bereich nicht.
        </p>
        <StatCards stats={stats} />
        <div className="mt-6">
          <HitRateTimeline data={timeline} />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DistributionChart correct={stats.correct} wrong={stats.wrong} />
          <DistributionBarChart correct={stats.correct} wrong={stats.wrong} />
        </div>
      </section>

      {/* Die frühere Rangliste stand nur für Prognosen. Die Instrumentenkarte
            zeigt daneben die Trades — sonst bliebe die eigentliche Frage
            unbeantwortet: Liegt es an der Analyse oder an der Umsetzung? */}
      <section
        id="instrumente"
        aria-label="Instrumentübersicht"
        className="mt-10 scroll-mt-36 border-t border-border pt-8"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Instrumente · Prognose und Umsetzung</SectionLabel>
          <AddStockDialog />
        </div>
        <InstrumentCardGrid
          cards={instrumentData.cards}
          quotes={instrumentData.quotes}
          currency={currency}
          stocks={stocks}
        />
      </section>
    </main>
  );
}
