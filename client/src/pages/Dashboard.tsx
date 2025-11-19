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
