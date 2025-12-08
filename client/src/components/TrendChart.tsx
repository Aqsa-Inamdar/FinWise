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
}

export function TrendChart({ data, title = "Income vs Expenses Trend" }: TrendChartProps) {
  const headingId = useId();
  const descriptionId = useId();
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-md border bg-popover p-3 shadow-md">
          <p className="mb-1 text-sm font-medium">{payload[0].payload.month}</p>
          {payload.map((entry: any, index: number) => (
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
    ? `Income and expenses from ${firstMonth} through ${lastMonth}. Peak income $${maxIncome.toLocaleString()} and peak expenses $${maxExpenses.toLocaleString()}.`
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
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="income"
              stroke="hsl(var(--chart-5))"
              strokeWidth={2}
              name="Income"
              dot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              stroke="hsl(var(--chart-4))"
              strokeWidth={2}
              name="Expenses"
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
        <table className="sr-only" aria-label={`${title} data`}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Income (USD)</th>
              <th scope="col">Expenses (USD)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <tr key={entry.month}>
                <td>{entry.month}</td>
                <td>${entry.income.toLocaleString()}</td>
                <td>${entry.expenses.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
