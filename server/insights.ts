import type { InsightCard, InsightSnapshot } from "@shared/schema";

type TransactionRecord = {
  date: string;
  description: string;
  category: string;
  amount: number | string;
  type: "income" | "expense";
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

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

export function buildMonthlyInsights(
  monthKey: string,
  transactions: TransactionRecord[]
): InsightSnapshot {
  const { start, end } = monthKeyToRange(monthKey);
  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevKey = toMonthKey(prevStart);
  const monthLabel = formatMonthLabel(monthKey);
  const previousMonthLabel = formatMonthLabel(prevKey);

  const currentMonthTransactions = transactions.filter((txn) => {
    const txnDate = new Date(txn.date);
    return txnDate >= start && txnDate < end;
  });
  const previousMonthTransactions = transactions.filter((txn) => {
    const txnDate = new Date(txn.date);
    return txnDate >= prevStart && txnDate < start;
  });

  const normalizedCurrent = currentMonthTransactions.map((txn) => ({
    ...txn,
    amount: Math.abs(safeNumber(txn.amount)),
  }));
  const normalizedPrevious = previousMonthTransactions.map((txn) => ({
    ...txn,
    amount: Math.abs(safeNumber(txn.amount)),
  }));

  const totalExpenses = normalizedCurrent
    .filter((txn) => txn.type === "expense")
    .reduce((sum, txn) => sum + txn.amount, 0);
  const totalIncome = normalizedCurrent
    .filter((txn) => txn.type === "income")
    .reduce((sum, txn) => sum + txn.amount, 0);
  const previousTotalExpenses = normalizedPrevious
    .filter((txn) => txn.type === "expense")
    .reduce((sum, txn) => sum + txn.amount, 0);
  const previousTotalIncome = normalizedPrevious
    .filter((txn) => txn.type === "income")
    .reduce((sum, txn) => sum + txn.amount, 0);

  const netCashflow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? netCashflow / totalIncome : null;

  const categoryTotals = normalizedCurrent
    .filter((txn) => txn.type === "expense")
    .reduce<Record<string, number>>((acc, txn) => {
      const key = txn.category || "Uncategorized";
      acc[key] = (acc[key] ?? 0) + txn.amount;
      return acc;
    }, {});

  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const [topCategoryName = "Uncategorized", topCategorySpend = 0] = sortedCategories[0] ?? [];
  const topCategoryShare = totalExpenses > 0 ? topCategorySpend / totalExpenses : 0;

  const previousCategoryTotals = normalizedPrevious
    .filter((txn) => txn.type === "expense")
    .reduce<Record<string, number>>((acc, txn) => {
      const key = txn.category || "Uncategorized";
      acc[key] = (acc[key] ?? 0) + txn.amount;
      return acc;
    }, {});

  const categoryChanges = Object.keys({ ...categoryTotals, ...previousCategoryTotals }).map(
    (category) => ({
      category,
      current: categoryTotals[category] ?? 0,
      previous: previousCategoryTotals[category] ?? 0,
      delta: (categoryTotals[category] ?? 0) - (previousCategoryTotals[category] ?? 0),
    })
  );
  const biggestIncrease = categoryChanges.sort((a, b) => b.delta - a.delta)[0];

  const topCategoryDaily = normalizedCurrent
    .filter((txn) => txn.type === "expense" && (txn.category || "Uncategorized") === topCategoryName)
    .reduce<Record<string, number>>((acc, txn) => {
      const dayKey = new Date(txn.date).toISOString().slice(0, 10);
      acc[dayKey] = (acc[dayKey] ?? 0) + txn.amount;
      return acc;
    }, {});

  const dailyValues = Object.values(topCategoryDaily);
  const dailyMean = dailyValues.length
    ? dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length
    : 0;
  const dailyVariance = dailyValues.length
    ? dailyValues.reduce((sum, value) => sum + (value - dailyMean) ** 2, 0) / dailyValues.length
    : 0;
  const dailyStdDev = Math.sqrt(dailyVariance);
  const variabilityRatio = dailyMean > 0 ? dailyStdDev / dailyMean : 0;

  const insights: InsightCard[] = [
    {
      id: "global-spend-trend",
      title: "Monthly Spending Trend",
      description:
        previousTotalExpenses === 0
          ? "No spending from last month to compare yet."
          : totalExpenses === previousTotalExpenses
          ? "Spending is unchanged from last month."
          : totalExpenses > previousTotalExpenses
          ? `Spending is higher than last month by ${currencyFormatter.format(
              totalExpenses - previousTotalExpenses
            )}.`
          : `Spending is lower than last month by ${currencyFormatter.format(
              previousTotalExpenses - totalExpenses
            )}.`,
      value: currencyFormatter.format(totalExpenses),
      reasoning: [
        `Month: ${monthLabel}.`,
        `Total expenses this month: ${currencyFormatter.format(totalExpenses)}.`,
        `Total expenses last month: ${currencyFormatter.format(previousTotalExpenses)}.`,
      ],
      scope: "global",
    },
    {
      id: "global-net-cashflow",
      title: "Net Cash Flow",
      description:
        totalIncome === 0 && totalExpenses === 0
          ? "No income or expenses recorded for this month."
          : netCashflow >= 0
          ? "You finished the month with positive cash flow."
          : "You spent more than you earned this month.",
      value: currencyFormatter.format(netCashflow),
      reasoning: [
        `Income total: ${currencyFormatter.format(totalIncome)}.`,
        `Expense total: ${currencyFormatter.format(totalExpenses)}.`,
        `Net cash flow: ${currencyFormatter.format(netCashflow)}.`,
      ],
      scope: "global",
    },
    {
      id: "global-savings-rate",
      title: "Savings Rate",
      description:
        savingsRate === null
          ? "Savings rate cannot be calculated without recorded income."
          : savingsRate >= 0.2
          ? "Your savings rate is healthy for this month."
          : "Your savings rate is below 20% this month.",
      value: savingsRate === null ? "N/A" : percentFormatter.format(savingsRate),
      reasoning: [
        "Savings rate = (income - expenses) ÷ income.",
        `Income recorded: ${currencyFormatter.format(totalIncome)}.`,
        `Expenses recorded: ${currencyFormatter.format(totalExpenses)}.`,
      ],
      scope: "global",
    },
    {
      id: "global-transaction-volume",
      title: "Transaction Volume",
      description:
        normalizedCurrent.length === 0
          ? "No transactions recorded yet for this month."
          : `You logged ${normalizedCurrent.length} transactions this month.`,
      value: `${normalizedCurrent.length}`,
      reasoning: [
        `Transactions recorded in ${monthLabel}: ${normalizedCurrent.length}.`,
        `Income transactions: ${normalizedCurrent.filter((txn) => txn.type === "income").length}.`,
        `Expense transactions: ${normalizedCurrent.filter((txn) => txn.type === "expense").length}.`,
      ],
      scope: "global",
    },
    {
      id: "category-top-share",
      title: "Top Spending Category",
      description:
        totalExpenses === 0
          ? "No expense categories recorded yet this month."
          : `${topCategoryName} is your largest category at ${percentFormatter.format(
              topCategoryShare
            )} of expenses.`,
      value: currencyFormatter.format(topCategorySpend),
      reasoning: [
        `Top category: ${topCategoryName}.`,
        `Category spend: ${currencyFormatter.format(topCategorySpend)}.`,
        `Total expenses: ${currencyFormatter.format(totalExpenses)}.`,
      ],
      scope: "category",
    },
    {
      id: "category-biggest-change",
      title: "Category Change (MoM)",
      description:
        previousTotalExpenses === 0
          ? "No previous month category data to compare yet."
          : !biggestIncrease || biggestIncrease.delta <= 0
          ? "No category increased versus last month."
          : `${biggestIncrease.category} increased the most month over month.`,
      value:
        biggestIncrease && previousTotalExpenses > 0
          ? currencyFormatter.format(biggestIncrease.delta)
          : "N/A",
      reasoning: [
        `Month-over-month category deltas compare ${previousMonthLabel} to ${monthLabel}.`,
        `Largest increase: ${biggestIncrease?.category ?? "Uncategorized"} (${currencyFormatter.format(
          biggestIncrease?.delta ?? 0
        )}).`,
        `Previous month total expenses: ${currencyFormatter.format(previousTotalExpenses)}.`,
      ],
      scope: "category",
    },
    {
      id: "category-variability",
      title: `${topCategoryName} Spend Variability`,
      description:
        totalExpenses === 0
          ? "No category variability calculated for this month."
          : dailyValues.length < 2
          ? "Not enough days of activity to assess variability."
          : variabilityRatio > 0.6
          ? "Spending in this category is highly variable."
          : "Spending in this category is relatively consistent.",
      value: dailyValues.length < 2 ? "N/A" : percentFormatter.format(variabilityRatio),
      reasoning: [
        `Daily spend analyzed for ${topCategoryName}.`,
        `Days with activity: ${dailyValues.length}.`,
        `Variability ratio (std ÷ mean): ${
          dailyValues.length < 2 ? "N/A" : variabilityRatio.toFixed(2)
        }.`,
      ],
      scope: "category",
    },
  ];

  return {
    month: monthKey,
    generatedAt: new Date().toISOString(),
    insights,
  };
}
