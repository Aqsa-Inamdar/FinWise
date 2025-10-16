import { InsightCard } from "../InsightCard";
import { Coffee } from "lucide-react";

export default function InsightCardExample() {
  return (
    <div className="p-4">
      <InsightCard
        title="Coffee Shop Visits"
        description="You spent $85 on coffee this month. Consider brewing at home to save."
        icon={Coffee}
        value="$85"
        testId="insight-example"
      />
    </div>
  );
}
