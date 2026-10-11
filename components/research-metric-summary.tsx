import type { ResearchMetrics } from "@/lib/research-metrics";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
const value = (v: number | null, suffix: string) =>
  v === null
    ? "Nicht berechenbar"
    : v.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + suffix;
export function ResearchMetricSummary({
  metrics,
  compact = false,
}: {
  metrics: ResearchMetrics;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "flex flex-col gap-2" : "grid gap-3 md:grid-cols-2"}
    >
      {(["money", "demo"] as const).map((kind) => {
        const g = metrics[kind];
        const content = (
          <>
            <p className="font-mono text-xs">
              {kind === "money" ? "Echtgeld" : "Demo"} · {g.completed}{" "}
              abgeschlossen
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                ["Gewinnquote netto", g.winRate, "%"],
                ["Ø geplantes CRV", g.averageCRV, ""],
                ["Ø realisiertes R", g.averageR, " R"],
              ].map(([label, m, suffix]) => {
                const metric = m as typeof g.winRate;
                return (
                  <div key={String(label)}>
                    <p className="text-xs text-muted-foreground">
                      {String(label)}
                    </p>
                    <p className="font-mono text-sm">
                      {value(metric.value, String(suffix))}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      n={metric.n} · {metric.missing} ohne Grundlage
                    </p>
                  </div>
                );
              })}
            </div>
            {g.currencies.map((c) => (
              <p className="text-xs text-muted-foreground" key={c.currency}>
                {c.currency}: {value(c.net, "")} netto · n={c.n} · {c.missing}{" "}
                unvollständig
              </p>
            ))}
          </>
        );
        return compact ? (
          <div
            key={kind}
            className="flex flex-col gap-2 border-t border-border/50 pt-2"
          >
            {content}
          </div>
        ) : (
          <Card key={kind}>
            <CardHeader>
              <CardTitle>
                {kind === "money"
                  ? "Tatsächliche Echtgeld-Trades"
                  : "Demo-Trades"}
              </CardTitle>
              <CardDescription>
                Netto nach erfassten Kosten · Break-even im Nenner ·
                ursprünglicher Plan
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">{content}</CardContent>
          </Card>
        );
      })}
    </div>
  );
}
