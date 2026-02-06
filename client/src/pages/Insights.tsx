import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { BarChart3, Layers, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { InsightCard } from "@/components/InsightCard";
import { getAuthHeader } from "@/lib/queryClient";
import { insightSnapshotSchema, type InsightSnapshot } from "@shared/schema";

const getInsightIcon = (id: string, scope: "global" | "category") => {
  if (id === "global-spend-trend") return TrendingUp;
  if (id === "global-net-cashflow") return TrendingDown;
  if (id === "global-transaction-volume") return Activity;
  if (scope === "category") return Layers;
  return BarChart3;
};

export default function Insights() {
  const [selectedMonth, setSelectedMonth] = React.useState(() =>
    format(new Date(), "yyyy-MM")
  );

  const { data, isLoading, error } = useQuery<InsightSnapshot>({
    queryKey: ["/api/insights", selectedMonth],
    queryFn: async () => {
      const authHeader = await getAuthHeader();
      const response = await fetch(`/api/insights?month=${selectedMonth}`,
        {
          headers: authHeader,
          credentials: "include",
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to load insights");
      }
      const result = await response.json();
      const parsed = insightSnapshotSchema.safeParse(result);
      if (!parsed.success) {
        throw new Error("Invalid insights response from server.");
      }
      return parsed.data;
    },
  });

  const monthLabel = React.useMemo(() => {
    const parsedDate = parse(`${selectedMonth}-01`, "yyyy-MM-dd", new Date());
    return format(parsedDate, "MMMM yyyy");
  }, [selectedMonth]);

  const insights = data?.insights ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight" data-testid="text-insights-title">
          Financial Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Monthly, explainable insights based on your logged activity for{" "}
          <span className="font-medium text-foreground">{monthLabel}</span>.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="insights-month" className="text-sm font-medium text-foreground">
              Month
            </label>
            <input
              id="insights-month"
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {(error as Error).message}
          </p>
        )}
        {isLoading && (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            Loading transactions for this month…
          </p>
        )}
      </div>

      <section aria-label="Overall insights" className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Overall Insights</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {insights
            .filter((insight) => insight.scope === "global")
            .map((insight) => (
              <InsightCard
                key={insight.id}
                title={insight.title}
                description={insight.description}
                icon={getInsightIcon(insight.id, insight.scope)}
                value={insight.value}
                reasoning={insight.reasoning}
                testId={`insight-${insight.id}`}
              />
            ))}
        </div>
      </section>

      <section aria-label="Category insights" className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Category Insights</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {insights
            .filter((insight) => insight.scope === "category")
            .map((insight) => (
              <InsightCard
                key={insight.id}
                title={insight.title}
                description={insight.description}
                icon={getInsightIcon(insight.id, insight.scope)}
                value={insight.value}
                reasoning={insight.reasoning}
                testId={`insight-${insight.id}`}
              />
            ))}
        </div>
      </section>
    </div>
  );
}
