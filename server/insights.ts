import type { Insight, InsightSnapshot } from "@shared/schema";

type TransactionRecord = {
  date: string;
  description: string;
  category: string;
  amount: number | string;
  type: "income" | "expense";
};

type MonthlyTotals = {
  income: number;
  expenses: number;
  savingsRate: number | null;
};

type DailyStats = {
  mean: number;
  std: number;
  min: number;
  max: number;
  cv: number;
  days: number;
};

type WeekdayWeekendStats = {
  weekdayAvg: number;
  weekendAvg: number;
  differentialPct: number;
  meaningful: boolean;
  weekdayDays: number;
  weekendDays: number;
};

const safeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toMonthKey = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const monthKeyToRange = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { start, end };
};

const formatMonthLabel = (monthKey: string) => {
  const { start } = monthKeyToRange(monthKey);
  return start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

const average = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const percentChange = (current: number, baseline: number) => {
  if (!baseline) return 0;
  return (current - baseline) / baseline;
};

const isMeaningfulChange = (current: number, baseline: number, threshold = 0.05) => {
  if (!baseline) return false;
  return Math.abs(percentChange(current, baseline)) >= threshold;
};

const severityFromImpact = (impact: number) => {
  if (impact >= 0.15) return "high" as const;
  if (impact >= 0.08) return "medium" as const;
  return "low" as const;
};

const classifyVariability = (cv: number) => {
  if (cv < 0.25) return "Stable" as const;
  if (cv > 0.5) return "Burst-Driven" as const;
  return "Moderate Variability" as const;
};

const shouldSurfaceWeekendShift = (weekdayAvg: number, weekendAvg: number) => {
  if (!weekdayAvg || !weekendAvg) return false;
  const delta = Math.abs(weekdayAvg - weekendAvg) / Math.max(weekdayAvg, weekendAvg);
  return delta >= 0.2;
};

const cleanRecommendation = (insight: Insight) => {
  if (!insight.recommendation) {
    const cleaned: Insight = { ...insight };
    delete (cleaned as { recommendation?: string }).recommendation;
    return cleaned;
  }
  return insight;
};

const normalizeTransactions = (transactions: TransactionRecord[]) =>
  transactions
    .map((txn) => ({
      ...txn,
      amount: Math.abs(safeNumber(txn.amount)),
      category: txn.category || "Uncategorized",
    }))
    .filter((txn) => !Number.isNaN(new Date(txn.date).getTime()));

const computeMonthlyTotals = (transactions: TransactionRecord[]) => {
  const monthlyTotals = new Map<string, MonthlyTotals>();
  transactions.forEach((txn) => {
    const date = new Date(txn.date);
    if (Number.isNaN(date.getTime())) return;
    const key = toMonthKey(date);
    const entry = monthlyTotals.get(key) ?? { income: 0, expenses: 0, savingsRate: null };
    const amount = safeNumber(txn.amount);
    if (txn.type === "income") {
      entry.income += amount;
    } else {
      entry.expenses += amount;
    }
    monthlyTotals.set(key, entry);
  });

  for (const [key, entry] of Array.from(monthlyTotals.entries())) {
    entry.savingsRate = entry.income > 0 ? (entry.income - entry.expenses) / entry.income : null;
    monthlyTotals.set(key, entry);
  }

  return monthlyTotals;
};

const computeCategoryTotals = (transactions: TransactionRecord[]) =>
  transactions
    .filter((txn) => txn.type === "expense")
    .reduce<Record<string, number>>((acc, txn) => {
      acc[txn.category] = (acc[txn.category] ?? 0) + safeNumber(txn.amount);
      return acc;
    }, {});

const computeDailyStats = (transactions: TransactionRecord[]): DailyStats | null => {
  const dailyMap = new Map<string, number>();
  transactions
    .filter((txn) => txn.type === "expense")
    .forEach((txn) => {
      const date = new Date(txn.date);
      if (Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + safeNumber(txn.amount));
    });

  const values = Array.from(dailyMap.values());
  if (values.length === 0) return null;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  const std = Math.sqrt(variance);
  return {
    mean,
    std,
    min: Math.min(...values),
    max: Math.max(...values),
    cv: mean > 0 ? std / mean : 0,
    days: values.length,
  };
};

const weekdayWeekendStats = (transactions: TransactionRecord[]): WeekdayWeekendStats => {
  let weekdayTotal = 0;
  let weekdayDays = new Set<string>();
  let weekendTotal = 0;
  let weekendDays = new Set<string>();

  transactions
    .filter((txn) => txn.type === "expense")
    .forEach((txn) => {
      const date = new Date(txn.date);
      if (Number.isNaN(date.getTime())) return;
      const day = date.getUTCDay();
      const key = date.toISOString().slice(0, 10);
      const amount = safeNumber(txn.amount);
      if (day === 0 || day === 6) {
        weekendTotal += amount;
        weekendDays.add(key);
      } else {
        weekdayTotal += amount;
        weekdayDays.add(key);
      }
    });

  const weekdayAvg = weekdayDays.size ? weekdayTotal / weekdayDays.size : 0;
  const weekendAvg = weekendDays.size ? weekendTotal / weekendDays.size : 0;

  const differentialPct =
    weekdayAvg && weekendAvg
      ? Math.abs(weekdayAvg - weekendAvg) / Math.max(weekdayAvg, weekendAvg)
      : 0;
  return {
    weekdayAvg,
    weekendAvg,
    differentialPct,
    meaningful: differentialPct >= 0.2 && weekdayDays.size >= 3 && weekendDays.size >= 2,
    weekdayDays: weekdayDays.size,
    weekendDays: weekendDays.size,
  };
};

const executiveSummary = (params: {
  monthLabel: string;
  spendDeltaPct: number | null;
  savingsDeltaPct: number | null;
  driverCategory?: string;
  variabilityLabel: string;
}) => {
  const sentences: string[] = [];

  if (params.spendDeltaPct === null) {
    sentences.push(`Spending in ${params.monthLabel} did not have enough history for comparison.`);
  } else if (Math.abs(params.spendDeltaPct) < 0.03) {
    sentences.push(`Spending in ${params.monthLabel} stayed close to your recent baseline.`);
  } else if (params.spendDeltaPct > 0) {
    sentences.push(`Spending in ${params.monthLabel} moved higher than your recent baseline.`);
  } else {
    sentences.push(`Spending in ${params.monthLabel} came in below your recent baseline.`);
  }

  if (params.savingsDeltaPct !== null) {
    if (params.savingsDeltaPct > 0) {
      sentences.push("More of your income was saved compared with recent months.");
    } else if (params.savingsDeltaPct < 0) {
      sentences.push("Savings were under pressure compared with recent months.");
    }
  }

  if (params.driverCategory) {
    sentences.push(`${params.driverCategory} was the main contributor to the spending shift.`);
  }

  sentences.push(`Day-to-day spending was ${params.variabilityLabel.toLowerCase()} this month.`);

  return sentences.slice(0, 4).join(" ");
};

const buildExecutiveInsight = (message: string): Insight => ({
  id: "executive-summary",
  type: "executive_summary",
  severity: "low",
  title: "Executive Summary",
  message,
});

const prioritizeInsights = (insights: Insight[], maxCount = 4) => {
  const priorityOrder = { risk: 0, data_quality: 1, neutral: 2, positive: 3, executive_summary: -1 } as const;
  const severityOrder = { high: 0, medium: 1, low: 2 } as const;

  const executive = insights.find((insight) => insight.type === "executive_summary");
  const rest = insights.filter((insight) => insight.type !== "executive_summary");

  const sorted = rest.sort((a, b) => {
    if (priorityOrder[a.type] !== priorityOrder[b.type]) {
      return priorityOrder[a.type] - priorityOrder[b.type];
    }
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return a.title.localeCompare(b.title);
  });

  const limited = executive ? [executive, ...sorted].slice(0, maxCount) : sorted.slice(0, maxCount);
  return limited;
};

export function buildMonthlyInsights(
  monthKey: string,
  transactions: TransactionRecord[],
  behavioralProfile?: import("./behavioralEngine").BehavioralProfile
): InsightSnapshot {
  const { start, end } = monthKeyToRange(monthKey);
  const monthLabel = formatMonthLabel(monthKey);

  const normalized = normalizeTransactions(transactions);
  const currentMonthTransactions = normalized.filter((txn) => {
    const txnDate = new Date(txn.date);
    return txnDate >= start && txnDate < end;
  });

  const previousMonthDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const previousMonthKey = toMonthKey(previousMonthDate);
  const previousRange = monthKeyToRange(previousMonthKey);

  const previousMonthTransactions = normalized.filter((txn) => {
    const txnDate = new Date(txn.date);
    return txnDate >= previousRange.start && txnDate < previousRange.end;
  });

  const monthlyTotals = computeMonthlyTotals(normalized);
  const currentTotals = monthlyTotals.get(monthKey) ?? { income: 0, expenses: 0, savingsRate: null };
  const previousTotals = monthlyTotals.get(previousMonthKey) ?? {
    income: 0,
    expenses: 0,
    savingsRate: null,
  };

  const historyKeys = Array.from(monthlyTotals.keys()).filter((key) => key < monthKey).sort();
  const last3Months = historyKeys.slice(-3);
  const last6Months = historyKeys.slice(-6);

  const avg3Spend = average(last3Months.map((key) => monthlyTotals.get(key)?.expenses ?? 0));
  const avg6Savings = average(last6Months.map((key) => monthlyTotals.get(key)?.savingsRate ?? 0));

  const spendDeltaPct = avg3Spend ? percentChange(currentTotals.expenses, avg3Spend) : null;
  const savingsDeltaPct =
    currentTotals.savingsRate !== null && avg6Savings
      ? currentTotals.savingsRate - avg6Savings
      : null;

  const categoryTotals = computeCategoryTotals(currentMonthTransactions);
  const previousCategoryTotals = computeCategoryTotals(previousMonthTransactions);
  const totalSpendChange = currentTotals.expenses - previousTotals.expenses;

  const categoryChanges = Object.keys({ ...categoryTotals, ...previousCategoryTotals }).map(
    (category) => ({
      category,
      current: categoryTotals[category] ?? 0,
      previous: previousCategoryTotals[category] ?? 0,
      delta: (categoryTotals[category] ?? 0) - (previousCategoryTotals[category] ?? 0),
    })
  );

  const driverCandidates = categoryChanges
    .filter((item) => totalSpendChange !== 0)
    .map((item) => ({
      ...item,
      contribution: totalSpendChange !== 0 ? item.delta / totalSpendChange : 0,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const driverInsights: Insight[] = [];
  const meaningfulDrivers = driverCandidates.filter((item) => Math.abs(item.contribution) >= 0.4).slice(0, 2);
  meaningfulDrivers.forEach((item) => {
    const direction = item.delta >= 0 ? "higher" : "lower";
    driverInsights.push({
      id: `driver-${item.category.toLowerCase()}`,
      type: item.delta >= 0 ? "risk" : "positive",
      severity: severityFromImpact(Math.abs(item.contribution)),
      title: `${item.category} was ${direction} than last month`,
      message: `${item.category} spending was the largest driver of the monthly change in expenses.`,
      recommendation: item.delta > 0 ? "Review this category for any unexpected increases." : undefined,
    });
  });

  const uncategorizedRatio =
    currentTotals.expenses > 0
      ? (categoryTotals["Uncategorized"] ?? 0) / currentTotals.expenses
      : 0;

  const dataQualityInsight: Insight | null =
    uncategorizedRatio > 0.3
      ? {
          id: "data-quality-uncategorized",
          type: "data_quality",
          severity: uncategorizedRatio > 0.5 ? "high" : "medium",
          title: "Too much spending is uncategorized",
          message: "A large portion of expenses are missing categories, which hides what changed.",
          recommendation: "Categorize those transactions to get more accurate insights.",
        }
      : null;

  const dailyStats = computeDailyStats(currentMonthTransactions);
  let variabilityLabel = behavioralProfile?.spendingStats.variabilityClass ?? "moderate variability";
  let behavioralInsight: Insight | null = null;

  if (!dailyStats || dailyStats.days < 7 || behavioralProfile?.spendingStats.variabilityClass === "INSUFFICIENT_DATA") {
    behavioralInsight = {
      id: "spending-variability",
      type: "data_quality",
      severity: "low",
      title: "Not enough activity to measure variability",
      message: "There isn't enough daily spending data yet to assess consistency.",
      recommendation: "Keep logging expenses to unlock this insight.",
    };
    variabilityLabel = "moderate variability";
  } else {
    const variabilityClass = behavioralProfile?.spendingStats.variabilityClass
      ? behavioralProfile.spendingStats.variabilityClass
      : classifyVariability(dailyStats.cv);
    variabilityLabel = variabilityClass;
    const localWeekdayWeekend = weekdayWeekendStats(currentMonthTransactions);
    const weekdayWeekend = behavioralProfile?.weekdayWeekend ?? localWeekdayWeekend;
    const weekdayDaysRaw = (weekdayWeekend as { weekdayDays?: unknown }).weekdayDays;
    const weekendDaysRaw = (weekdayWeekend as { weekendDays?: unknown }).weekendDays;
    const weekdayDays =
      typeof weekdayDaysRaw === "number" ? weekdayDaysRaw : localWeekdayWeekend.weekdayDays;
    const weekendDays =
      typeof weekendDaysRaw === "number" ? weekendDaysRaw : localWeekdayWeekend.weekendDays;
    const showWeekendShift =
      weekdayWeekend.meaningful ??
      (weekdayDays >= 3 &&
        weekendDays >= 2 &&
        shouldSurfaceWeekendShift(weekdayWeekend.weekdayAvg, weekdayWeekend.weekendAvg));

    let message = "Daily spending stayed within your typical range.";
    if (variabilityClass === "Burst-Driven" || variabilityClass === "HIGH") {
      message = "Spending was concentrated in a few higher-cost days.";
    } else if (variabilityClass === "Moderate Variability" || variabilityClass === "MODERATE") {
      message = "Daily spending varied but remained within a normal band.";
    }

    if (showWeekendShift) {
      message += " Weekend spending patterns differed from weekdays.";
    }

    behavioralInsight = {
      id: "spending-variability",
      type: variabilityClass === "Burst-Driven" ? "risk" : "neutral",
      severity: variabilityClass === "Burst-Driven" ? "medium" : "low",
      title: `Spending variability was ${variabilityClass.toLowerCase()}`,
      message,
    };
  }

  const spendTrendInsight: Insight | null = avg3Spend
    ? (() => {
        const deltaPct = percentChange(currentTotals.expenses, avg3Spend);
        if (Math.abs(deltaPct) < 0.03) {
          return {
            id: "spending-trend-neutral",
            type: "neutral",
            severity: "low",
            title: "Spending stayed consistent",
            message: `Spending in ${monthLabel} stayed close to your recent baseline.`,
          };
        }
        if (deltaPct >= 0.05) {
          return {
            id: "spending-trend-up",
            type: "risk",
            severity: severityFromImpact(Math.abs(deltaPct)),
            title: "Spending increased versus recent months",
            message: `Spending in ${monthLabel} rose compared with your recent average.`,
            recommendation: "Review recent purchases to see which costs can be reduced.",
          };
        }
        if (deltaPct <= -0.05) {
          return {
            id: "spending-trend-down",
            type: "positive",
            severity: "low",
            title: "Spending decreased versus recent months",
            message: `Spending in ${monthLabel} came in below your recent baseline.`,
          };
        }
        return null;
      })()
    : null;

  const savingsInsight: Insight | null =
    currentTotals.savingsRate !== null &&
    avg6Savings &&
    isMeaningfulChange(currentTotals.savingsRate, avg6Savings, 0.05)
      ? {
          id: "savings-rate-change",
          type: currentTotals.savingsRate >= avg6Savings ? "positive" : "risk",
          severity: Math.abs(currentTotals.savingsRate - avg6Savings) >= 0.1 ? "medium" : "low",
          title:
            currentTotals.savingsRate >= avg6Savings
              ? "Savings rate improved"
              : "Savings rate declined",
          message: "Savings performance shifted compared with your recent baseline.",
          recommendation:
            currentTotals.savingsRate >= avg6Savings
              ? undefined
              : "Check recent expenses to keep savings on track.",
        }
      : null;

  const driverCategory = meaningfulDrivers[0]?.category;
  const summaryMessage = executiveSummary({
    monthLabel,
    spendDeltaPct,
    savingsDeltaPct,
    driverCategory,
    variabilityLabel,
  });

  const executiveInsight = buildExecutiveInsight(summaryMessage);

  const baseInsights = [
    executiveInsight,
    spendTrendInsight,
    savingsInsight,
    dataQualityInsight,
    behavioralInsight,
    ...driverInsights,
  ].filter(Boolean) as Insight[];

  // Avoid redundancy: if executive summary exists, drop neutral spend trend unless it's the only trend signal.
  const filteredInsights = baseInsights.filter((insight) => {
    if (insight.id === "spending-trend-neutral") return false;
    return true;
  });

  const prioritized = prioritizeInsights(filteredInsights);

  return {
    month: monthKey,
    generatedAt: new Date().toISOString(),
    insights: prioritized.map(cleanRecommendation),
  };
}

export { prioritizeInsights };
