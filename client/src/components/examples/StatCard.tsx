import { StatCard } from "../StatCard";
import { DollarSign } from "lucide-react";

export default function StatCardExample() {
  return (
    <div className="p-4">
      <StatCard
        title="Total Income"
        value="$5,500"
        trend={{ value: 8.2, isPositive: true }}
        icon={<DollarSign className="h-5 w-5" />}
        testId="card-example"
      />
    </div>
  );
}
