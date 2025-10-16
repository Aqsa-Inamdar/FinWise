import { DollarSign, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ExpenseChart } from "@/components/ExpenseChart";
import { TrendChart } from "@/components/TrendChart";

export default function Dashboard() {
  // TODO: remove mock data
  const expenseData = [
    { category: "Rent/Housing", amount: 1500, color: "hsl(var(--chart-1))" },
    { category: "Food/Groceries", amount: 800, color: "hsl(var(--chart-2))" },
    { category: "Transportation", amount: 400, color: "hsl(var(--chart-3))" },
    { category: "Entertainment", amount: 300, color: "hsl(var(--chart-4))" },
    { category: "Utilities", amount: 250, color: "hsl(var(--chart-5))" },
  ];

  const trendData = [
    { month: "Jan", income: 5000, expenses: 3200 },
    { month: "Feb", income: 5200, expenses: 3400 },
    { month: "Mar", income: 5100, expenses: 3100 },
    { month: "Apr", income: 5300, expenses: 3250 },
    { month: "May", income: 5400, expenses: 3500 },
    { month: "Jun", income: 5500, expenses: 3250 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight" data-testid="text-dashboard-title">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Your financial overview at a glance
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Income"
          value="$5,500"
          trend={{ value: 8.2, isPositive: true }}
          icon={<TrendingUp className="h-5 w-5" />}
          testId="card-income"
        />
        <StatCard
          title="Total Expenses"
          value="$3,250"
          trend={{ value: 4.5, isPositive: false }}
          icon={<TrendingDown className="h-5 w-5" />}
          testId="card-expenses"
        />
        <StatCard
          title="Net Savings"
          value="$2,250"
          trend={{ value: 12.3, isPositive: true }}
          icon={<Wallet className="h-5 w-5" />}
          testId="card-savings"
        />
        <StatCard
          title="Savings Rate"
          value="41%"
          icon={<DollarSign className="h-5 w-5" />}
          testId="card-rate"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ExpenseChart data={expenseData} />
        <TrendChart data={trendData} />
      </div>
    </div>
  );
}
