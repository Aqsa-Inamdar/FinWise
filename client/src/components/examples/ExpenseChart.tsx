import { ExpenseChart } from "../ExpenseChart";

export default function ExpenseChartExample() {
  const data = [
    { category: "Rent", amount: 1500, color: "hsl(var(--chart-1))" },
    { category: "Food", amount: 800, color: "hsl(var(--chart-2))" },
    { category: "Transport", amount: 400, color: "hsl(var(--chart-3))" },
  ];

  return (
    <div className="p-4">
      <ExpenseChart data={data} />
    </div>
  );
}
