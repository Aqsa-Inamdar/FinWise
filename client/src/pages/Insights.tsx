import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  Sparkles,
  Activity,
  PieChart,
} from "lucide-react";
import { getAuthHeader } from "@/lib/queryClient";
import { insightSnapshotSchema, type InsightSnapshot } from "@shared/schema";
import { useFirestoreTransactions } from "@/hooks/useFirestoreTransactions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const currencyNoCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const formatMoney = (value: number, opts?: { compact?: boolean }) => {
  if (!Number.isFinite(value)) return "N/A";
  return (opts?.compact ? currencyNoCents : currency).format(value);
};

type BehavioralProfile = {
  spendingStats: {
    meanDailySpend: number;
    stdDailySpend: number;
    cv: number;
    variabilityClass: "LOW" | "MODERATE" | "HIGH" | "INSUFFICIENT_DATA";
    percentileRank: number | null;
  };
  concentrationStats: {
    categoryEntropy: number;
    topCategoryShare: number;
    concentrationClass: "LOW" | "MODERATE" | "HIGH";
  };
  savingsStats: {
    avgMonthlySavings: number;
    stdMonthlySavings: number;
    savingsCV: number;
  };
  structuralShift: {
    distributionChangeScore: number;
    shiftDetected: boolean;
  };
  rollingBaselines: {
    threeMonthAvgSpend: number;
    threeMonthAvgSavings: number;
  };
  weekdayWeekend: {
    weekdayAvg: number;
    weekendAvg: number;
    differentialPct: number;
    meaningful: boolean;
  };
};

const getInsightIcon = (type: InsightSnapshot["insights"][number]["type"]) => {
  if (type === "risk") return AlertTriangle;
  if (type === "data_quality") return ShieldAlert;
  if (type === "positive") return CheckCircle2;
  if (type === "executive_summary") return Sparkles;
  return Info;
};

const getAccent = (type: InsightSnapshot["insights"][number]["type"]) => {
  if (type === "risk") return "bg-rose-100 text-rose-700";
  if (type === "data_quality") return "bg-amber-100 text-amber-700";
  if (type === "positive") return "bg-emerald-100 text-emerald-700";
  if (type === "executive_summary") return "bg-indigo-100 text-indigo-700";
  return "bg-slate-100 text-slate-700";
};

export default function Insights() {
  const [selectedMonth, setSelectedMonth] = React.useState(() => format(new Date(), "yyyy-MM"));
  const { transactions } = useFirestoreTransactions();

  const { data, isLoading, error } = useQuery<InsightSnapshot>({
    queryKey: ["/api/insights", selectedMonth],
    queryFn: async () => {
      const authHeader = await getAuthHeader();
      const response = await fetch(`/api/insights?month=${selectedMonth}`, {
        headers: authHeader,
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to load insights");
      }
      const result = await response.json();
      const parsed = insightSnapshotSchema.safeParse(result);
      if (!parsed.success) {
        const refreshResponse = await fetch(`/api/insights?month=${selectedMonth}&refresh=1`, {
          headers: authHeader,
          credentials: "include",
        });
        if (!refreshResponse.ok) {
          const refreshText = await refreshResponse.text();
          throw new Error(refreshText || "Invalid insights response from server.");
        }
        const refreshed = await refreshResponse.json();
        const refreshedParsed = insightSnapshotSchema.safeParse(refreshed);
        if (!refreshedParsed.success) {
          throw new Error("Invalid insights response from server.");
        }
        return refreshedParsed.data;
      }
      return parsed.data;
    },
  });

  const { data: behavioralProfile } = useQuery<BehavioralProfile>({
    queryKey: ["/api/behavioral-profile", selectedMonth],
    queryFn: async () => {
      const authHeader = await getAuthHeader();
      const response = await fetch(`/api/behavioral-profile?month=${selectedMonth}`, {
        headers: authHeader,
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to load behavioral profile");
      }
      return response.json();
    },
  });

  const monthLabel = React.useMemo(() => {
    const parsedDate = parse(`${selectedMonth}-01`, "yyyy-MM-dd", new Date());
    return format(parsedDate, "MMMM yyyy");
  }, [selectedMonth]);

  const insights = data?.insights ?? [];

  const monthKey = selectedMonth;
  const monthlyTotals = React.useMemo(() => {
    const map = new Map<string, { income: number; expenses: number }>();
    transactions.forEach((txn) => {
      const date = new Date(txn.date);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const entry = map.get(key) ?? { income: 0, expenses: 0 };
      if (txn.type === "income") entry.income += Number(txn.amount);
      if (txn.type === "expense") entry.expenses += Number(txn.amount);
      map.set(key, entry);
    });
    return map;
  }, [transactions]);

  const currentTotals = React.useMemo(() => {
    const entry = monthlyTotals.get(monthKey) ?? { income: 0, expenses: 0 };
    const savings = entry.income - entry.expenses;
    const savingsRate = entry.income > 0 ? savings / entry.income : 0;
    return { ...entry, savings, savingsRate };
  }, [monthlyTotals, monthKey]);

  const rollingAverages = React.useMemo(() => {
    const keys = Array.from(monthlyTotals.keys())
      .filter((key) => key < monthKey)
      .sort();
    const last6 = keys.slice(-6);
    const last3 = keys.slice(-3);
    const avg = (values: number[]) =>
      values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    const sixMonthSavings = last6.map((key) => {
      const entry = monthlyTotals.get(key) ?? { income: 0, expenses: 0 };
      return entry.income > 0 ? (entry.income - entry.expenses) / entry.income : 0;
    });
    const threeMonthSpend = last3.map((key) => monthlyTotals.get(key)?.expenses ?? 0);
    return {
      avg6SavingsRate: avg(sixMonthSavings),
      avg3Spend: avg(threeMonthSpend),
    };
  }, [monthlyTotals, monthKey]);

  const previousMonthKey = React.useMemo(() => {
    const parsedDate = parse(`${monthKey}-01`, "yyyy-MM-dd", new Date());
    const prev = new Date(Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth() - 1, 1));
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  }, [monthKey]);

  const categoryDeltas = React.useMemo(() => {
    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();
    transactions.forEach((txn) => {
      if (txn.type !== "expense") return;
      const key = txn.date.slice(0, 7);
      const map = key === monthKey ? currentMap : key === previousMonthKey ? previousMap : null;
      if (!map) return;
      map.set(txn.category, (map.get(txn.category) ?? 0) + Number(txn.amount));
    });
    const totalDelta =
      (currentTotals.expenses ?? 0) - (monthlyTotals.get(previousMonthKey)?.expenses ?? 0);
    const allCategories = Array.from(
      new Set([...Array.from(currentMap.keys()), ...Array.from(previousMap.keys())])
    );
    const deltas = allCategories.map((category) => {
      const current = currentMap.get(category) ?? 0;
      const previous = previousMap.get(category) ?? 0;
      const delta = current - previous;
      const contribution = totalDelta ? delta / totalDelta : 0;
      return { category, delta, contribution };
    });
    return { totalDelta, deltas };
  }, [transactions, monthKey, previousMonthKey, currentTotals.expenses, monthlyTotals]);

  const dailySeries = React.useMemo(() => {
    const dailyMap = new Map<string, number>();
    transactions
      .filter((txn) => txn.type === "expense" && txn.date.startsWith(monthKey))
      .forEach((txn) => {
        const key = txn.date.slice(0, 10);
        dailyMap.set(key, (dailyMap.get(key) ?? 0) + Number(txn.amount));
      });
    return Array.from(dailyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
  }, [transactions, monthKey]);

  const monthlySeries = React.useMemo(() => {
    return Array.from(monthlyTotals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, values]) => {
        const [year, month] = key.split("-");
        const label = `${monthLabels[Number(month) - 1]} ${year.slice(2)}`;
        return { month: label, income: values.income, expenses: values.expenses };
      });
  }, [monthlyTotals]);

  const [selectedInsight, setSelectedInsight] = React.useState<InsightSnapshot["insights"][number] | null>(null);

  const buildBullets = (insight: InsightSnapshot["insights"][number]) => {
    const bullets: string[] = [];
    if (insight.id.includes("spending-trend")) {
      if (rollingAverages.avg3Spend > 0) {
        const changePct = ((currentTotals.expenses - rollingAverages.avg3Spend) / rollingAverages.avg3Spend) * 100;
        bullets.push(`3‑month average: ${formatMoney(rollingAverages.avg3Spend, { compact: true })}`);
        bullets.push(`Change vs baseline: ${changePct.toFixed(1)}%`);
      }
    }
    if (insight.id === "savings-rate-change") {
      const avg = rollingAverages.avg6SavingsRate * 100;
      const current = currentTotals.savingsRate * 100;
      bullets.push(`Current savings rate: ${current.toFixed(1)}%`);
      bullets.push(`6‑month average: ${avg.toFixed(1)}%`);
    }
    if (insight.id.startsWith("driver-")) {
      const driver = categoryDeltas.deltas.find((item) => insight.id.includes(item.category.toLowerCase()));
      if (driver) {
        bullets.push(`Contribution to change: ${(driver.contribution * 100).toFixed(0)}%`);
        bullets.push(`Category delta: ${formatMoney(Math.abs(driver.delta), { compact: true })}`);
      }
    }
    if (insight.id === "spending-variability" && behavioralProfile) {
      bullets.push(`Day-to-day variation: ${behavioralProfile.spendingStats.variabilityClass.toLowerCase()}`);
      bullets.push(
        `Typical day swings by about ${formatMoney(behavioralProfile.spendingStats.stdDailySpend, {
          compact: true,
        })}`
      );
      bullets.push(
        `Average daily spend: ${formatMoney(behavioralProfile.spendingStats.meanDailySpend, { compact: true })}`
      );
      if (behavioralProfile.weekdayWeekend.meaningful) {
        bullets.push(
          `Weekday avg: ${formatMoney(behavioralProfile.weekdayWeekend.weekdayAvg, { compact: true })}`
        );
      }
    }
    return bullets;
  };

  const displayTitle = (insight: InsightSnapshot["insights"][number]) => {
    if (insight.id === "savings-rate-change") {
      return insight.message.includes("improved") ? "More income was saved" : "Savings were under pressure";
    }
    if (insight.id === "spending-trend-up") {
      return "Spending ran above baseline";
    }
    if (insight.id === "spending-trend-down") {
      return "Spending came in below baseline";
    }
    if (insight.id === "executive-summary") {
      return "Executive Summary";
    }
    return insight.title;
  };

  const renderInsightDetails = () => {
    if (!selectedInsight) return null;
    const evidenceBullets = buildBullets(selectedInsight);
    if (selectedInsight.id === "spending-variability" && behavioralProfile) {
      return (
        <div className="space-y-4">
          {evidenceBullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {evidenceBullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Variability class</p>
              <p className="text-base font-semibold">{behavioralProfile.spendingStats.variabilityClass}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Typical day-to-day swing</p>
              <p className="text-base font-semibold">
                {formatMoney(behavioralProfile.spendingStats.stdDailySpend, { compact: true })}
              </p>
            </div>
          </div>
          <div className="rounded-md border p-3 text-sm text-slate-600">
            This estimate comes from the spread of daily expenses. We calculate the average daily spend and
            measure how far typical days deviate from that average.
          </div>
          <div className="rounded-md border p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-900">How we calculated this</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Daily spend is the sum of all expense transactions per day.</li>
              <li>
                Typical day swing is the standard deviation of daily totals (based on{" "}
                {dailySeries.length} active days).
              </li>
              <li>
                Variability class compares this month’s swing to your recent history to label it low,
                moderate, or high.
              </li>
            </ul>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => formatMoney(Number(value), { compact: true })} />
                <Tooltip
                  formatter={(value) => formatMoney(Number(value))}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Bar dataKey="value" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    if (selectedInsight.id.includes("spending-trend") || selectedInsight.id === "executive-summary") {
      const changePct = rollingAverages.avg3Spend
        ? ((currentTotals.expenses - rollingAverages.avg3Spend) / rollingAverages.avg3Spend) * 100
        : 0;
      return (
        <div className="space-y-4">
          {evidenceBullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {evidenceBullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Current month expenses</p>
              <p className="text-base font-semibold">{formatMoney(currentTotals.expenses)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">3‑month average</p>
              <p className="text-base font-semibold">{formatMoney(rollingAverages.avg3Spend)}</p>
            </div>
          </div>
          {rollingAverages.avg3Spend > 0 && (
            <p className="text-sm text-muted-foreground">Change vs baseline: {changePct.toFixed(1)}%</p>
          )}
          <div className="rounded-md border p-3 text-sm text-slate-600">
            Baseline is the average of your last 3 months of expenses. The change shows how far this month
            moved from that baseline.
          </div>
          <div className="rounded-md border p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-900">How we calculated this</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Monthly expenses are the sum of all expense transactions for {monthLabel}.</li>
              <li>3‑month baseline is the average of the last 3 months with data.</li>
              <li>Change vs baseline = (current − baseline) ÷ baseline.</li>
            </ul>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => formatMoney(Number(value), { compact: true })} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Line type="monotone" dataKey="income" stroke="hsl(var(--chart-5))" strokeWidth={2} />
                <Line type="monotone" dataKey="expenses" stroke="hsl(var(--chart-4))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    if (selectedInsight.id.startsWith("driver-") && behavioralProfile) {
      const driver = categoryDeltas.deltas.find((item) => selectedInsight.id.includes(item.category.toLowerCase()));
      return (
        <div className="space-y-2 text-sm text-muted-foreground">
          {evidenceBullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {evidenceBullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p>Category concentration: {behavioralProfile.concentrationStats.concentrationClass}.</p>
          <p>Top category share: {(behavioralProfile.concentrationStats.topCategoryShare * 100).toFixed(0)}%.</p>
          {driver && (
            <p>
              Contribution to monthly change: {(driver.contribution * 100).toFixed(0)}% ({driver.delta >= 0 ? "increase" : "decrease"}).
            </p>
          )}
          <div className="rounded-md border p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-900">How we calculated this</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Category change = this month’s category spend − last month’s category spend.</li>
              <li>Contribution = category change ÷ total spending change.</li>
              <li>We only highlight drivers that materially move the monthly total.</li>
            </ul>
          </div>
        </div>
      );
    }

    if (selectedInsight.id === "savings-rate-change") {
      const avg = rollingAverages.avg6SavingsRate * 100;
      const current = currentTotals.savingsRate * 100;
      return (
        <div className="space-y-2 text-sm text-muted-foreground">
          {evidenceBullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {evidenceBullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p>Current savings rate: {current.toFixed(1)}%</p>
          <p>6‑month average: {avg.toFixed(1)}%</p>
          <div className="rounded-md border p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-900">How we calculated this</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Savings = income − expenses.</li>
              <li>Savings rate = savings ÷ income.</li>
              <li>We compare this month’s rate to your 6‑month average.</li>
            </ul>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        {evidenceBullets.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {evidenceBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <p>This insight is based on your logged transactions for {monthLabel}.</p>
        <div className="rounded-md border p-3 text-sm text-slate-600">
          <p className="font-medium text-slate-900">How we calculated this</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>We summarize your transactions for the selected month.</li>
            <li>Amounts shown are totals of income and expense entries you recorded.</li>
            <li>Insights are derived from those monthly totals and patterns.</li>
          </ul>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight" data-testid="text-insights-title">
          Financial Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Monthly, behavioral insights based on your logged activity for{" "}
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

      <section aria-label="Monthly insights" className="space-y-4">
        <div className="grid gap-5 lg:grid-cols-2">
          {insights.map((insight) => {
            const Icon = getInsightIcon(insight.type);
            const accent = getAccent(insight.type);
            const bullets = buildBullets(insight);
            return (
              <div key={insight.id} className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-full ${accent}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{displayTitle(insight)}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {insight.message}
                      {insight.recommendation ? ` ${insight.recommendation}` : ""}
                    </p>
                  </div>
                </div>
                {bullets.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {insight.recommendation && (
                  <p className="mt-3 text-sm font-medium text-foreground">
                    Next step: <span className="font-normal text-muted-foreground">{insight.recommendation}</span>
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedInsight(insight)}>
                    Why this insight
                  </Button>
                  {insight.type === "executive_summary" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      <Activity className="h-3 w-3" /> Summary
                    </span>
                  )}
                  {insight.type === "data_quality" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                      <ShieldAlert className="h-3 w-3" /> Data quality
                    </span>
                  )}
                  {insight.type === "risk" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700">
                      <AlertTriangle className="h-3 w-3" /> Risk
                    </span>
                  )}
                  {insight.type === "positive" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Positive
                    </span>
                  )}
                  {insight.id === "savings-rate-change" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700">
                      <PieChart className="h-3 w-3" /> Savings
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Dialog open={Boolean(selectedInsight)} onOpenChange={() => setSelectedInsight(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedInsight?.title}</DialogTitle>
            <DialogDescription>{selectedInsight?.message}</DialogDescription>
          </DialogHeader>
          {renderInsightDetails()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
