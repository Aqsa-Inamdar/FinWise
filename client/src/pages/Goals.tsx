import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { GoalCard } from "@/components/GoalCard";

export default function Goals() {
  // TODO: remove mock data
  const goals = [
    {
      id: "1",
      title: "Emergency Fund",
      current: 8500,
      target: 10000,
      deadline: "Dec 31, 2025",
      status: "on-track" as const,
    },
    {
      id: "2",
      title: "Vacation to Europe",
      current: 2800,
      target: 5000,
      deadline: "Jun 15, 2026",
      status: "on-track" as const,
    },
    {
      id: "3",
      title: "New Laptop",
      current: 600,
      target: 1500,
      deadline: "Mar 30, 2025",
      status: "behind" as const,
    },
    {
      id: "4",
      title: "Home Down Payment",
      current: 15000,
      target: 50000,
      deadline: "Dec 31, 2026",
      status: "approaching" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight" data-testid="text-goals-title">
            Savings Goals
          </h1>
          <p className="text-sm text-muted-foreground">
            Track your progress towards financial milestones
          </p>
        </div>
        <Button data-testid="button-add-goal" onClick={() => console.log("Add goal clicked")}>
          <Plus className="mr-2 h-4 w-4" />
          Add Goal
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {goals.map((goal) => (
          <GoalCard
            key={goal.id}
            title={goal.title}
            current={goal.current}
            target={goal.target}
            deadline={goal.deadline}
            status={goal.status}
            testId={`goal-${goal.id}`}
          />
        ))}
      </div>
    </div>
  );
}
