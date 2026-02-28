import { useMemo, useState } from "react";
import { GoalCard } from "@/components/GoalCard";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AddGoalDialog } from "@/components/AddGoalDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
  allocationOverride?: number | null;
  savingsLeftAfterGoal?: number;
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
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<{ goals: GoalResponse[]; totalSavingsPool?: number }>({
    queryKey: ["/api/goals"],
  });
  const goals = data?.goals ?? [];
  const sortedGoals = useMemo(() => [...goals].sort((a, b) => {
    const aTime = new Date(a.deadline).getTime();
    const bTime = new Date(b.deadline).getTime();
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid) return aTime - bTime;
    if (aValid) return -1;
    if (bValid) return 1;
    return a.name.localeCompare(b.name);
  }), [goals]);

  const displayGoals = useMemo(() => {
    let runningPool = Math.max(0, Number(data?.totalSavingsPool) || 0);
    return sortedGoals.map((goal) => {
      const target = Math.max(0, Number(goal.targetAmount) || 0);
      const overrideRaw = goal.allocationOverride;
      const hasOverride = overrideRaw != null && Number.isFinite(Number(overrideRaw));
      const requested = hasOverride ? Math.min(target, Math.max(0, Number(overrideRaw))) : target;
      const allocatedAmount = Math.min(requested, runningPool);
      runningPool = Math.max(0, runningPool - allocatedAmount);

      return {
        ...goal,
        allocatedAmount,
        savingsLeftAfterGoal: runningPool,
      };
    });
  }, [sortedGoals, data?.totalSavingsPool]);

  const [editingGoal, setEditingGoal] = useState<GoalResponse | null>(null);
  const [formName, setFormName] = useState("");
  const [formTargetAmount, setFormTargetAmount] = useState("");
  const [formDeadline, setFormDeadline] = useState("");
  const [formAllocationOverride, setFormAllocationOverride] = useState("");

  const startEditing = (goal: GoalResponse) => {
    setEditingGoal(goal);
    setFormName(goal.name);
    setFormTargetAmount(String(goal.targetAmount));
    setFormDeadline(new Date(goal.deadline).toISOString().slice(0, 10));
    setFormAllocationOverride(
      goal.allocationOverride == null ? "" : String(goal.allocationOverride),
    );
  };

  const updateGoalMutation = useMutation({
    mutationFn: async () => {
      if (!editingGoal) throw new Error("No goal selected");
      const payload = {
        name: formName,
        targetAmount: Number(formTargetAmount),
        deadline: formDeadline,
        allocationOverride:
          formAllocationOverride.trim() === ""
            ? null
            : Number(formAllocationOverride),
      };
      await apiRequest("PATCH", `/api/goals/${editingGoal.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal updated", description: "Your goal was updated successfully." });
      setEditingGoal(null);
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      await apiRequest("DELETE", `/api/goals/${goalId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal deleted", description: "Goal card removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

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
          displayGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              title={goal.name}
              current={goal.allocatedAmount}
              savingsLeftAfterGoal={goal.savingsLeftAfterGoal}
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
              onEdit={() => startEditing(goal)}
              onDelete={() => {
                const confirmed = window.confirm(`Delete goal "${goal.name}"?`);
                if (confirmed) deleteGoalMutation.mutate(goal.id);
              }}
              testId={`goal-${goal.id}`}
            />
          ))}
      </div>

      <Dialog open={Boolean(editingGoal)} onOpenChange={(open) => !open && setEditingGoal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Goal</DialogTitle>
            <DialogDescription>
              Update goal name, target, deadline, or set a custom savings allocation for this goal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Goal name</p>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Target amount</p>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={formTargetAmount}
                onChange={(e) => setFormTargetAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Deadline</p>
              <Input type="date" value={formDeadline} onChange={(e) => setFormDeadline(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Savings allocated to this goal (optional override)</p>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Leave empty for automatic allocation"
                value={formAllocationOverride}
                onChange={(e) => setFormAllocationOverride(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingGoal(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateGoalMutation.mutate()}
              disabled={updateGoalMutation.isPending}
            >
              {updateGoalMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
