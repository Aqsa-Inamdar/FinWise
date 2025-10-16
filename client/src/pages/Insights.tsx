import { TrendingDown, ShoppingBag, Coffee, AlertTriangle } from "lucide-react";
import { InsightCard } from "@/components/InsightCard";

export default function Insights() {
  // TODO: remove mock data
  const insights = [
    {
      id: "1",
      title: "Top Spending Category",
      description: "Rent/Housing accounts for 46% of your monthly expenses. This is within the recommended 30-40% range.",
      icon: TrendingDown,
      value: "$1,500",
    },
    {
      id: "2",
      title: "Spending Trend",
      description: "Your expenses increased by 12% compared to last month. Consider reviewing discretionary spending.",
      icon: ShoppingBag,
    },
    {
      id: "3",
      title: "Coffee Shop Visits",
      description: "You spent $85 on coffee this month. That's about $1,020 per year. Consider brewing at home to save.",
      icon: Coffee,
      value: "$85",
    },
    {
      id: "4",
      title: "Budget Alert",
      description: "You're 85% through your Entertainment budget with 10 days left in the month. Consider limiting spending.",
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight" data-testid="text-insights-title">
          Financial Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Personalized recommendations based on your spending patterns
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((insight) => (
          <InsightCard
            key={insight.id}
            title={insight.title}
            description={insight.description}
            icon={insight.icon}
            value={insight.value}
            testId={`insight-${insight.id}`}
          />
        ))}
      </div>
    </div>
  );
}
