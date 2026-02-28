import { firestore } from "./firebaseAdmin";

export type BehavioralProfile = {
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

type TransactionRecord = {
  date: string;
  description: string;
  category: string;
  amount: number | string;
  type: "income" | "expense";
};

type MonthTotals = {
  income: number;
  expenses: number;
  savings: number;
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

const safeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const average = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const aggregateDailySpend = (transactions: TransactionRecord[]) => {
  const daily = new Map<string, number>();
  transactions.forEach((txn) => {
    if (txn.type !== "expense") return;
    const parsed = new Date(txn.date);
    if (Number.isNaN(parsed.getTime())) return;
    const key = parsed.toISOString().slice(0, 10);
    const amount = Math.abs(safeNumber(txn.amount));
    daily.set(key, (daily.get(key) ?? 0) + amount);
  });
  return daily;
};

export const computeBasicStats = (values: number[]) => {
  if (!values.length) {
    return { mean: 0, std: 0, min: 0, max: 0, cv: 0 };
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return {
    mean,
    std,
    min: Math.min(...values),
    max: Math.max(...values),
    cv: mean > 0 ? std / mean : 0,
  };
};

export const classifyVariability = (cv: number, historicalCvs: number[]) => {
  if (!historicalCvs.length) {
    if (cv < 0.25) return { label: "LOW" as const, percentileRank: null };
    if (cv > 0.5) return { label: "HIGH" as const, percentileRank: null };
    return { label: "MODERATE" as const, percentileRank: null };
  }

  const sorted = [...historicalCvs].sort((a, b) => a - b);
  const index = sorted.findIndex((value) => cv <= value);
  const rank = index === -1 ? 1 : index / sorted.length;

  if (rank <= 0.33) return { label: "LOW" as const, percentileRank: rank };
  if (rank >= 0.66) return { label: "HIGH" as const, percentileRank: rank };
  return { label: "MODERATE" as const, percentileRank: rank };
};

export const computeCategoryEntropy = (categoryTotals: Record<string, number>) => {
  const total = Object.values(categoryTotals).reduce((sum, v) => sum + v, 0);
  if (!total) return 0;
  return Object.values(categoryTotals).reduce((sum, value) => {
    const p = value / total;
    return p > 0 ? sum - p * Math.log2(p) : sum;
  }, 0);
};

export const computeStructuralShift = (
  currentDist: Record<string, number>,
  previousDist: Record<string, number>
) => {
  const categories = new Set([...Object.keys(currentDist), ...Object.keys(previousDist)]);
  let change = 0;
  categories.forEach((category) => {
    const current = currentDist[category] ?? 0;
    const previous = previousDist[category] ?? 0;
    change += Math.abs(current - previous);
  });
  return change / 2;
};

const computeCategoryTotals = (transactions: TransactionRecord[]) =>
  transactions
    .filter((txn) => txn.type === "expense")
    .reduce<Record<string, number>>((acc, txn) => {
      const category = txn.category || "Uncategorized";
      acc[category] = (acc[category] ?? 0) + Math.abs(safeNumber(txn.amount));
      return acc;
    }, {});

const computeDistribution = (categoryTotals: Record<string, number>) => {
  const total = Object.values(categoryTotals).reduce((sum, v) => sum + v, 0);
  if (!total) return {};
  const dist: Record<string, number> = {};
  Object.entries(categoryTotals).forEach(([category, value]) => {
    dist[category] = value / total;
  });
  return dist;
};

const computeMonthTotals = (transactions: TransactionRecord[]) => {
  const monthly = new Map<string, MonthTotals>();
  transactions.forEach((txn) => {
    const date = new Date(txn.date);
    if (Number.isNaN(date.getTime())) return;
    const key = toMonthKey(date);
    const entry = monthly.get(key) ?? { income: 0, expenses: 0, savings: 0 };
    const amount = Math.abs(safeNumber(txn.amount));
    if (txn.type === "income") entry.income += amount;
    if (txn.type === "expense") entry.expenses += amount;
    entry.savings = entry.income - entry.expenses;
    monthly.set(key, entry);
  });
  return monthly;
};

const computeWeekdayWeekend = (transactions: TransactionRecord[]) => {
  let weekdaySpend = 0;
  let weekendSpend = 0;
  const weekdayDays = new Set<string>();
  const weekendDays = new Set<string>();

  transactions
    .filter((txn) => txn.type === "expense")
    .forEach((txn) => {
      const date = new Date(txn.date);
      if (Number.isNaN(date.getTime())) return;
      const day = date.getUTCDay();
      const key = date.toISOString().slice(0, 10);
      const amount = Math.abs(safeNumber(txn.amount));
      if (day === 0 || day === 6) {
        weekendSpend += amount;
        weekendDays.add(key);
      } else {
        weekdaySpend += amount;
        weekdayDays.add(key);
      }
    });

  const weekdayAvg = weekdayDays.size ? weekdaySpend / weekdayDays.size : 0;
  const weekendAvg = weekendDays.size ? weekendSpend / weekendDays.size : 0;
  const differentialPct =
    weekdayAvg && weekendAvg
      ? Math.abs(weekdayAvg - weekendAvg) / Math.max(weekdayAvg, weekendAvg)
      : 0;

  return {
    weekdayAvg,
    weekendAvg,
    differentialPct,
    meaningful: differentialPct >= 0.2 && weekdayDays.size >= 3 && weekendDays.size >= 2,
  };
};

export async function buildBehavioralProfile(userId: string, period: string): Promise<BehavioralProfile> {
  const { start, end } = monthKeyToRange(period);
  const previousMonthKey = toMonthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)));

  const transactionsSnapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("transactions")
    .where("date", ">=", start.toISOString())
    .where("date", "<", end.toISOString())
    .get();

  const allTransactionsSnapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("transactions")
    .get();

  const transactions = transactionsSnapshot.docs.map((doc) => doc.data() as TransactionRecord);
  const allTransactions = allTransactionsSnapshot.docs.map((doc) => doc.data() as TransactionRecord);

  const dailySpend = aggregateDailySpend(transactions);
  const dailyStats = computeBasicStats(Array.from(dailySpend.values()));

  const historicalCvs = await firestore
    .collection("users")
    .doc(userId)
    .collection("insights")
    .get()
    .then((snapshot) =>
      snapshot.docs
        .map((doc) => doc.data()?.variabilityStats?.cv)
        .filter((value) => typeof value === "number") as number[]
    );

  const variability = classifyVariability(dailyStats.cv, historicalCvs);

  const categoryTotals = computeCategoryTotals(transactions);
  const previousTotals = computeCategoryTotals(
    allTransactions.filter((txn) => toMonthKey(new Date(txn.date)) === previousMonthKey)
  );

  const categoryEntropy = computeCategoryEntropy(categoryTotals);
  const topCategoryShare = (() => {
    const total = Object.values(categoryTotals).reduce((sum, v) => sum + v, 0);
    if (!total) return 0;
    const top = Math.max(...Object.values(categoryTotals));
    return top / total;
  })();

  const concentrationClass =
    categoryEntropy < 1.0 ? "HIGH" : categoryEntropy < 1.5 ? "MODERATE" : "LOW";

  const currentDist = computeDistribution(categoryTotals);
  const previousDist = computeDistribution(previousTotals);
  const distributionChangeScore = computeStructuralShift(currentDist, previousDist);

  const shiftDetected = distributionChangeScore > 0.2;

  const monthlyTotals = computeMonthTotals(allTransactions);
  const historyKeys = Array.from(monthlyTotals.keys()).sort();
  const lastThree = historyKeys.slice(-3);
  const lastSix = historyKeys.slice(-6);

  const threeMonthAvgSpend = average(lastThree.map((key) => monthlyTotals.get(key)?.expenses ?? 0));
  const threeMonthAvgSavings = average(lastThree.map((key) => monthlyTotals.get(key)?.savings ?? 0));

  const savingsValues = lastSix.map((key) => monthlyTotals.get(key)?.savings ?? 0);
  const savingsStats = computeBasicStats(savingsValues);

  const weekdayWeekend = computeWeekdayWeekend(transactions);

  const variabilityClass =
    dailySpend.size < 7 ? "INSUFFICIENT_DATA" : variability.label;

  return {
    spendingStats: {
      meanDailySpend: dailyStats.mean,
      stdDailySpend: dailyStats.std,
      cv: dailyStats.cv,
      variabilityClass,
      percentileRank: variability.percentileRank,
    },
    concentrationStats: {
      categoryEntropy,
      topCategoryShare,
      concentrationClass,
    },
    savingsStats: {
      avgMonthlySavings: average(savingsValues),
      stdMonthlySavings: savingsStats.std,
      savingsCV: savingsStats.mean > 0 ? savingsStats.std / savingsStats.mean : 0,
    },
    structuralShift: {
      distributionChangeScore,
      shiftDetected,
    },
    rollingBaselines: {
      threeMonthAvgSpend,
      threeMonthAvgSavings,
    },
    weekdayWeekend,
  };
}
