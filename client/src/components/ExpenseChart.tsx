import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface ExpenseData {
  category: string;
  amount: number;
  color: string;
}

interface ExpenseChartProps {
  data: ExpenseData[];
  title?: string;
}

export function ExpenseChart({ data, title = "Expenses by Category" }: ExpenseChartProps) {
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  const headingId = useId();
  const descriptionId = useId();
  const sortedData = [...data].sort((a, b) => b.amount - a.amount);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const percentage = ((payload[0].value / total) * 100).toFixed(1);
      return (
        <div className="rounded-md border bg-popover p-2 shadow-md">
          <p className="text-sm font-medium">{payload[0].name}</p>
          <p className="text-sm text-muted-foreground">
            ${payload[0].value.toLocaleString()} ({percentage}%)
          </p>
        </div>
      );
    }
    return null;
  };

  const chartSummary = total
    ? `You have ${data.length} expense categories totaling $${total.toLocaleString()}. The highest category is ${sortedData[0]?.category ?? "none"} with $${sortedData[0]?.amount.toLocaleString() ?? 0}.`
    : "No expenses available to chart.";

  return (
    <Card
      data-testid="card-expense-chart"
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
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={100}
              fill="#8884d8"
              dataKey="amount"
              nameKey="category"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
        <table className="sr-only" aria-label={`${title} data`}>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Amount (USD)</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((entry) => (
              <tr key={entry.category}>
                <td>{entry.category}</td>
                <td>${entry.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
