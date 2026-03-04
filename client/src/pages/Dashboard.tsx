import { DollarSign, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StatCard } from "@/components/StatCard";
import { ExpenseChart } from "@/components/ExpenseChart";
import { TrendChart } from "@/components/TrendChart";
import { AddExpenseDialog } from "@/components/AddExpenseDialog";
import { AddIncomeDialog } from "@/components/AddIncomeDialog";
import { useFirestoreTransactions } from "@/hooks/useFirestoreTransactions";

export default function Dashboard() {
  const { transactions, loading, error } = useFirestoreTransactions();
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Calculate totals
  const totalIncome = transactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const totalExpenses = transactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const netSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? ((netSavings / totalIncome) * 100) : 0;

  // Group expenses by category for chart
  const categoryMap = new Map<string, number>();
  transactions
    .filter((item) => item.type === "expense")
    .forEach((expense) => {
      const current = categoryMap.get(expense.category) || 0;
      categoryMap.set(expense.category, current + Number(expense.amount));
    });

  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  const expenseData = Array.from(categoryMap.entries()).map(([category, amount], index) => ({
    category,
    amount,
    color: chartColors[index % chartColors.length],
  }));

  const allDates = transactions
    .map((txn) => new Date(txn.date))
    .filter((date) => !Number.isNaN(date.getTime()));
  const latestDate = allDates.length ? new Date(Math.max(...allDates.map((d) => d.getTime()))) : new Date();
  const defaultEndYear = latestDate.getUTCFullYear();
  const defaultEndMonth = latestDate.getUTCMonth();
  const defaultStartDate = new Date(Date.UTC(defaultEndYear, defaultEndMonth - 11, 1));
  const [startYear, setStartYear] = useState(defaultStartDate.getUTCFullYear());
  const [startMonth, setStartMonth] = useState(defaultStartDate.getUTCMonth());
  const [endYear, setEndYear] = useState(defaultEndYear);
  const [endMonth, setEndMonth] = useState(defaultEndMonth);
  const [showIncome, setShowIncome] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState("all");

  const monthKey = (year: number, monthIndex: number) =>
    `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    allDates.forEach((date) => years.add(date.getUTCFullYear()));
    years.add(new Date().getUTCFullYear());
    return Array.from(years).sort((a, b) => a - b);
  }, [transactions]);

  const monthlyTotals = useMemo(() => {
    const map = new Map<string, { income: number; expenses: number }>();
    transactions.forEach((txn) => {
      const date = new Date(txn.date);
      if (Number.isNaN(date.getTime())) return;
      const key = monthKey(date.getUTCFullYear(), date.getUTCMonth());
      const entry = map.get(key) ?? { income: 0, expenses: 0 };
      const amount = Number(txn.amount);
      if (txn.type === "income") entry.income += amount;
      if (txn.type === "expense") entry.expenses += amount;
      map.set(key, entry);
    });
    return map;
  }, [transactions]);

  const monthlyCategoryExpenses = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    transactions.forEach((txn) => {
      if (txn.type !== "expense") return;
      const date = new Date(txn.date);
      if (Number.isNaN(date.getTime())) return;
      const key = monthKey(date.getUTCFullYear(), date.getUTCMonth());
      const categoryMapForMonth = map.get(key) ?? new Map<string, number>();
      const category = txn.category || "Uncategorized";
      categoryMapForMonth.set(category, (categoryMapForMonth.get(category) ?? 0) + Number(txn.amount));
      map.set(key, categoryMapForMonth);
    });
    return map;
  }, [transactions]);

  const expenseCategories = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((txn) => {
      if (txn.type === "expense" && txn.category) set.add(txn.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const normalizeRange = (newStartYear: number, newStartMonth: number, newEndYear: number, newEndMonth: number) => {
    const start = new Date(Date.UTC(newStartYear, newStartMonth, 1));
    const end = new Date(Date.UTC(newEndYear, newEndMonth, 1));
    if (start > end) {
      return { startYear: newStartYear, startMonth: newStartMonth, endYear: newStartYear, endMonth: newStartMonth };
    }
    return { startYear: newStartYear, startMonth: newStartMonth, endYear: newEndYear, endMonth: newEndMonth };
  };

  const trendData = useMemo(() => {
    const normalized = normalizeRange(startYear, startMonth, endYear, endMonth);
    const start = new Date(Date.UTC(normalized.startYear, normalized.startMonth, 1));
    const end = new Date(Date.UTC(normalized.endYear, normalized.endMonth, 1));
    const points: Array<{ month: string; income: number; expenses: number }> = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = monthKey(cursor.getUTCFullYear(), cursor.getUTCMonth());
      const entry = monthlyTotals.get(key) ?? { income: 0, expenses: 0 };
      const categoryMonth = monthlyCategoryExpenses.get(key);
      const categoryExpense =
        selectedExpenseCategory === "all"
          ? entry.expenses
          : categoryMonth?.get(selectedExpenseCategory) ?? 0;
      points.push({
        month: `${monthLabels[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear()).slice(2)}`,
        income: entry.income,
        expenses: categoryExpense,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }, [startYear, startMonth, endYear, endMonth, monthlyTotals, monthlyCategoryExpenses, selectedExpenseCategory]);

  const handleStartChange = (nextYear: number, nextMonth: number) => {
    const normalized = normalizeRange(nextYear, nextMonth, endYear, endMonth);
    setStartYear(normalized.startYear);
    setStartMonth(normalized.startMonth);
    setEndYear(normalized.endYear);
    setEndMonth(normalized.endMonth);
  };

  const handleEndChange = (nextYear: number, nextMonth: number) => {
    const normalized = normalizeRange(startYear, startMonth, nextYear, nextMonth);
    setStartYear(normalized.startYear);
    setStartMonth(normalized.startMonth);
    setEndYear(normalized.endYear);
    setEndMonth(normalized.endMonth);
  };

  // Accessible loading state
  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        role="status"
        aria-live="polite"
      >
        <p className="text-muted-foreground">Loading your financial data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full" role="alert">
        <p className="text-muted-foreground">Unable to load transactions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="region" aria-labelledby="page-title">
      
      {/* Hidden screen-reader only page title */}
      <h1 id="page-title" className="sr-only">
        Dashboard Overview
      </h1>

      {/* Visible heading section */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2
            className="text-3xl font-light tracking-tight"
            data-testid="text-dashboard-title"
          >
            Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Your financial overview at a glance
          </p>
        </div>
        <div className="flex gap-2">
          <AddIncomeDialog />
          <AddExpenseDialog />
        </div>
      </div>

      {/* Summary cards */}
      <h2 className="sr-only">Financial Summary</h2>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div role="group" aria-label={`Total income ${totalIncome.toLocaleString()} dollars`}>
          <StatCard
            title="Total Income"
            value={`$${totalIncome.toLocaleString()}`}
            icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
            testId="card-income"
          />
        </div>

        <div role="group" aria-label={`Total expenses ${totalExpenses.toLocaleString()} dollars`}>
          <StatCard
            title="Total Expenses"
            value={`$${totalExpenses.toLocaleString()}`}
            icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
            testId="card-expenses"
          />
        </div>

        <div role="group" aria-label={`Net savings ${netSavings.toLocaleString()} dollars`}>
          <StatCard
            title="Net Savings"
            value={`$${netSavings.toLocaleString()}`}
            trend={{ value: netSavings > 0 ? 12.3 : 0, isPositive: netSavings > 0 }}
            icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
            testId="card-savings"
          />
        </div>

        <div role="group" aria-label={`Savings rate ${savingsRate.toFixed(0)} percent`}>
          <StatCard
            title="Savings Rate"
            value={`${savingsRate.toFixed(0)}%`}
            icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
            testId="card-rate"
          />
        </div>
      </div>

      {/* Charts */}
      {expenseData.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          
          {/* Expense Chart container with ARIA labels */}
          <div
            className="border rounded p-4"
            role="region"
            aria-labelledby="expenses-heading"
            aria-describedby="expenses-summary"
          >
            <h2 id="expenses-heading" className="text-xl font-semibold mb-2">
              Expenses Breakdown
            </h2>

            <p id="expenses-summary" className="sr-only">
              This chart displays your expenses grouped by category such as rent, groceries,
              entertainment, transportation, utilities, and other cost categories.
            </p>

            <ExpenseChart data={expenseData} aria-hidden="true" />
          </div>

          {/* Trend chart with ARIA labels */}
          <div
            className="border rounded p-4"
            role="region"
            aria-labelledby="trends-heading"
            aria-describedby="trends-summary"
          >
            <h2 id="trends-heading" className="text-xl font-semibold mb-2">
              Spending Trends
            </h2>

            <p id="trends-summary" className="sr-only">
              This chart shows changes in income and expenses over the past several months.
            </p>

            <div className="mb-4 flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">From</p>
                <div className="flex gap-2">
                  <Select
                    value={String(startMonth)}
                    onValueChange={(value) => handleStartChange(startYear, Number(value))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {monthLabels.map((label, index) => (
                        <SelectItem key={`start-month-${label}`} value={String(index)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(startYear)}
                    onValueChange={(value) => handleStartChange(Number(value), startMonth)}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((year) => (
                        <SelectItem key={`start-year-${year}`} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">To</p>
                <div className="flex gap-2">
                  <Select
                    value={String(endMonth)}
                    onValueChange={(value) => handleEndChange(endYear, Number(value))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {monthLabels.map((label, index) => (
                        <SelectItem key={`end-month-${label}`} value={String(index)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(endYear)}
                    onValueChange={(value) => handleEndChange(Number(value), endMonth)}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((year) => (
                        <SelectItem key={`end-year-${year}`} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={showIncome}
                    onCheckedChange={(value) => setShowIncome(Boolean(value))}
                  />
                  Income
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={showExpenses}
                    onCheckedChange={(value) => setShowExpenses(Boolean(value))}
                  />
                  Expenses
                </label>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium">Expense category</p>
                <Select value={selectedExpenseCategory} onValueChange={setSelectedExpenseCategory}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="All expenses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All expenses</SelectItem>
                    {expenseCategories.map((category) => (
                      <SelectItem key={`expense-category-${category}`} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <TrendChart
              data={trendData}
              title={selectedExpenseCategory === "all" ? "Income vs Expenses Trend" : `Income vs ${selectedExpenseCategory} Trend`}
              showIncome={showIncome}
              showExpenses={showExpenses}
              expensesLabel={selectedExpenseCategory === "all" ? "Expenses" : selectedExpenseCategory}
              aria-hidden="true"
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">
            No expenses tracked yet. Start by adding your first expense!
          </p>
          <AddExpenseDialog />
        </div>
      )}
    </div>
  );
}
