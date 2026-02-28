import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface TrendData {
  month: string;
  income: number;
  expenses: number;
}

interface TrendChartProps {
  data: TrendData[];
  title?: string;
  showIncome?: boolean;
  showExpenses?: boolean;
}

export function TrendChart({
  data,
  title = "Income vs Expenses Trend",
  showIncome = true,
  showExpenses = true,
}: TrendChartProps) {
  const headingId = useId();
  const descriptionId = useId();
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const filtered = payload.filter((entry: any) => {
        if (entry.dataKey === "income") return showIncome;
        if (entry.dataKey === "expenses") return showExpenses;
        return true;
      });
      if (!filtered.length) return null;
      return (
        <div className="rounded-md border bg-popover p-3 shadow-md">
          <p className="mb-1 text-sm font-medium">{filtered[0].payload.month}</p>
          {filtered.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: ${entry.value.toLocaleString()}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const firstMonth = data[0]?.month;
  const lastMonth = data[data.length - 1]?.month;
  const maxIncome = data.length ? Math.max(...data.map((item) => item.income)) : 0;
  const maxExpenses = data.length ? Math.max(...data.map((item) => item.expenses)) : 0;
  const chartSummary = data.length
    ? `Trend data from ${firstMonth} through ${lastMonth}.` +
      (showIncome ? ` Peak income $${maxIncome.toLocaleString()}.` : "") +
      (showExpenses ? ` Peak expenses $${maxExpenses.toLocaleString()}.` : "")
    : "No trend data available.";

  return (
    <Card
      data-testid="card-trend-chart"
      role="region"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <CardHeader>
        <CardTitle id={headingId}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p id={descriptionId} className="sr-only">
          {chartSummary}
        </p>
        <ResponsiveContainer width="100%" height={300} aria-hidden="true">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            {showExpenses && (
              <YAxis
                yAxisId="expenses"
                tick={{ fontSize: 12 }}
                orientation="left"
                width={48}
              />
            )}
            {showIncome && (
              <YAxis
                yAxisId="income"
                tick={{ fontSize: 12 }}
                orientation="right"
                width={48}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {showIncome && (
              <Line
                type="monotone"
                dataKey="income"
                yAxisId="income"
                stroke="hsl(var(--chart-5))"
                strokeWidth={2}
                name="Income"
                dot={{ r: 4 }}
              />
            )}
            {showExpenses && (
              <Line
                type="monotone"
                dataKey="expenses"
                yAxisId="expenses"
                stroke="hsl(var(--chart-4))"
                strokeWidth={2}
                name="Expenses"
                dot={{ r: 4 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
        <table className="sr-only" aria-label={`${title} data`}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {showIncome && <th scope="col">Income (USD)</th>}
              {showExpenses && <th scope="col">Expenses (USD)</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <tr key={entry.month}>
                <td>{entry.month}</td>
                {showIncome && <td>${entry.income.toLocaleString()}</td>}
                {showExpenses && <td>${entry.expenses.toLocaleString()}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
