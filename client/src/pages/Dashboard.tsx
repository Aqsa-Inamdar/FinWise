/* import { DollarSign, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ExpenseChart } from "@/components/ExpenseChart";
import { TrendChart } from "@/components/TrendChart";
import { AddExpenseDialog } from "@/components/AddExpenseDialog";
import { AddIncomeDialog } from "@/components/AddIncomeDialog";
import { useQuery } from "@tanstack/react-query";
import type { Expense, Income } from "@shared/schema";

export default function Dashboard() {
  const { data: expenses = [], isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["/api/expenses"],
  });

  const { data: income = [], isLoading: incomeLoading } = useQuery<Income[]>({
    queryKey: ["/api/income"],
  });

  // Calculate totals
  const totalIncome = income.reduce((sum, item) => sum + Number(item.amount), 0);
  const totalExpenses = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const netSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? ((netSavings / totalIncome) * 100) : 0;

  // Group expenses by category for chart
  const categoryMap = new Map<string, number>();
  expenses.forEach((expense) => {
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

  // Mock trend data (can be enhanced with real data later)
  const trendData = [
    { month: "Jan", income: totalIncome * 0.9, expenses: totalExpenses * 0.85 },
    { month: "Feb", income: totalIncome * 0.95, expenses: totalExpenses * 0.9 },
    { month: "Mar", income: totalIncome, expenses: totalExpenses },
  ];

  if (expensesLoading || incomeLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading your financial data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight" data-testid="text-dashboard-title">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Your financial overview at a glance
          </p>
        </div>
        <div className="flex gap-2">
          <AddIncomeDialog />
          <AddExpenseDialog />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Income"
          value={`$${totalIncome.toLocaleString()}`}
          icon={<TrendingUp className="h-5 w-5" />}
          testId="card-income"
        />
        <StatCard
          title="Total Expenses"
          value={`$${totalExpenses.toLocaleString()}`}
          icon={<TrendingDown className="h-5 w-5" />}
          testId="card-expenses"
        />
        <StatCard
          title="Net Savings"
          value={`$${netSavings.toLocaleString()}`}
          trend={{ value: netSavings > 0 ? 12.3 : 0, isPositive: netSavings > 0 }}
          icon={<Wallet className="h-5 w-5" />}
          testId="card-savings"
        />
        <StatCard
          title="Savings Rate"
          value={`${savingsRate.toFixed(0)}%`}
          icon={<DollarSign className="h-5 w-5" />}
          testId="card-rate"
        />
      </div>

      {expenseData.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ExpenseChart data={expenseData} />
          <TrendChart data={trendData} />
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No expenses tracked yet. Start by adding your first expense!</p>
          <AddExpenseDialog />
        </div>
      )}
    </div>
  );
}
*/ 

import { DollarSign, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ExpenseChart } from "@/components/ExpenseChart";
import { TrendChart } from "@/components/TrendChart";
import { AddExpenseDialog } from "@/components/AddExpenseDialog";
import { AddIncomeDialog } from "@/components/AddIncomeDialog";
import { useQuery } from "@tanstack/react-query";
import type { Expense, Income } from "@shared/schema";

export default function Dashboard() {
  const { data: expenses = [], isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["/api/expenses"],
  });

  const { data: income = [], isLoading: incomeLoading } = useQuery<Income[]>({
    queryKey: ["/api/income"],
  });

  // Calculate totals
  const totalIncome = income.reduce((sum, item) => sum + Number(item.amount), 0);
  const totalExpenses = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const netSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? ((netSavings / totalIncome) * 100) : 0;

  // Group expenses by category for chart
  const categoryMap = new Map<string, number>();
  expenses.forEach((expense) => {
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

  // Mock trend data (can be replaced later)
  const trendData = [
    { month: "Jan", income: totalIncome * 0.9, expenses: totalExpenses * 0.85 },
    { month: "Feb", income: totalIncome * 0.95, expenses: totalExpenses * 0.9 },
    { month: "Mar", income: totalIncome, expenses: totalExpenses },
  ];

  // Accessible loading state
  if (expensesLoading || incomeLoading) {
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

            <TrendChart data={trendData} aria-hidden="true" />
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
