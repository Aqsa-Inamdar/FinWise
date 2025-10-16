import { TrendChart } from "../TrendChart";

export default function TrendChartExample() {
  const data = [
    { month: "Jan", income: 5000, expenses: 3200 },
    { month: "Feb", income: 5200, expenses: 3400 },
    { month: "Mar", income: 5100, expenses: 3100 },
  ];

  return (
    <div className="p-4">
      <TrendChart data={data} />
    </div>
  );
}
