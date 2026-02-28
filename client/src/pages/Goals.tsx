import { GoalCard } from "@/components/GoalCard";
import { useQuery } from "@tanstack/react-query";
import { AddGoalDialog } from "@/components/AddGoalDialog";

type GoalProjectionResponse = {
  predictedMonthlySavings: number | null;
  projectedCompletionDate: string | null;
  status: "on_track" | "behind" | "at_risk" | "insufficient_data";
  contract?: {
    achievableByDeadline: boolean | null;
    probabilityAchievableByDeadline: number | null;
    projectedGoalBalanceAtDeadline: number | null;
    predictedCompletionDate: string | null;
    statusMessage: string;
    explainability: Array<{ label: string; impact: "positive" | "negative" | "neutral"; detail: string }>;
  };
};

type GoalResponse = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  projection?: GoalProjectionResponse;
};

const mapStatus = (
  status?: GoalProjectionResponse["status"],
): "on-track" | "approaching" | "behind" => {
  if (status === "on_track") return "on-track";
  if (status === "at_risk") return "approaching";
  return "behind";
};

export default function Goals() {
  const { data, isLoading, error } = useQuery<{ goals: GoalResponse[] }>({
    queryKey: ["/api/goals"],
  });
  const goals = data?.goals ?? [];

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
        <AddGoalDialog />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading goals...</p>}
        {error && (
          <p className="text-sm text-red-600">Unable to load goals. Please refresh and try again.</p>
        )}
        {!isLoading && !error && goals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No goals yet. Use Add Goal to start tracking.
          </p>
        )}
        {!isLoading &&
          !error &&
          goals.map((goal) => (
            <GoalCard
              key={goal.id}
              title={goal.name}
              current={goal.currentAmount}
              target={goal.targetAmount}
              deadline={new Date(goal.deadline).toLocaleDateString()}
              status={mapStatus(goal.projection?.status)}
              probabilityAchievableByDeadline={
                goal.projection?.contract?.probabilityAchievableByDeadline ?? null
              }
              projectedCompletionDate={
                goal.projection?.contract?.predictedCompletionDate
                  ? new Date(goal.projection.contract.predictedCompletionDate).toLocaleDateString()
                  : goal.projection?.projectedCompletionDate
                    ? new Date(goal.projection.projectedCompletionDate).toLocaleDateString()
                    : null
              }
              statusMessage={goal.projection?.contract?.statusMessage ?? null}
              explainability={goal.projection?.contract?.explainability ?? []}
              testId={`goal-${goal.id}`}
            />
          ))}
      </div>
    </div>
  );
}
