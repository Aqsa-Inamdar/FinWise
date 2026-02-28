import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GoalCardProps {
  title: string;
  current: number;
  savingsLeftAfterGoal?: number | null;
  target: number;
  deadline: string;
  status: "on-track" | "approaching" | "behind";
  probabilityAchievableByDeadline?: number | null;
  projectedCompletionDate?: string | null;
  statusMessage?: string | null;
  explainability?: Array<{ label: string; impact: "positive" | "negative" | "neutral"; detail: string }>;
  onEdit?: () => void;
  onDelete?: () => void;
  testId?: string;
}

export function GoalCard({
  title,
  current,
  savingsLeftAfterGoal,
  target,
  deadline,
  status,
  probabilityAchievableByDeadline,
  projectedCompletionDate,
  statusMessage,
  explainability,
  onEdit,
  onDelete,
  testId,
}: GoalCardProps) {
  const safeTarget = Math.max(0, target);
  const allocated = Math.min(Math.max(0, current), safeTarget);
  const percentage = safeTarget > 0 ? Math.min((allocated / safeTarget) * 100, 100) : 0;
  const remaining = Math.max(0, safeTarget - allocated);
  const poolLeft = Math.max(0, savingsLeftAfterGoal ?? 0);
  const titleId = useId();
  const statusId = useId();
  const progressId = useId();

  const statusConfig = {
    "on-track": { label: "On Track", className: "bg-green-500" },
    approaching: { label: "Approaching Deadline", className: "bg-amber-500" },
    behind: { label: "Behind Schedule", className: "bg-red-500" },
  };

  return (
    <Card
      className="hover-elevate"
      data-testid={testId}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={progressId}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle id={titleId} className="text-base font-medium">
          {title}
        </CardTitle>
        <Badge
          id={statusId}
          variant="secondary"
          className={cn("text-xs text-white", statusConfig[status].className)}
        >
          {statusConfig[status].label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress
          value={percentage}
          className="h-2"
          data-testid={`${testId}-progress`}
          aria-describedby={statusId}
        />
        <p id={progressId} className="sr-only">
          {`${title} is ${Math.round(percentage)} percent funded. $${allocated.toLocaleString()} allocated toward a goal of $${safeTarget.toLocaleString()} due by ${deadline}. Current status: ${statusConfig[status].label}.`}
        </p>
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Savings left after this goal</p>
            <p className="font-mono text-lg font-semibold" data-testid={`${testId}-current`}>
              ${poolLeft.toLocaleString()}
            </p>
          </div>
          <div className="space-y-1 text-right">
            <p className="text-xs text-muted-foreground">Goal target</p>
            <p className="font-mono text-lg font-semibold text-muted-foreground" data-testid={`${testId}-target`}>
              ${safeTarget.toLocaleString()}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-allocated`}>
          Allocated to this goal: ${allocated.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-deadline`}>
          Deadline: {deadline}
        </p>
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-remaining`}>
          Remaining to complete: ${remaining.toLocaleString()}
        </p>
        {typeof probabilityAchievableByDeadline === "number" && (
          <p className="text-xs text-muted-foreground" data-testid={`${testId}-probability`}>
            Achievability probability: {(probabilityAchievableByDeadline * 100).toFixed(1)}%
          </p>
        )}
        {projectedCompletionDate && (
          <p className="text-xs text-muted-foreground" data-testid={`${testId}-projected-completion`}>
            Projected completion: {projectedCompletionDate}
          </p>
        )}
        {statusMessage && (
          <p className="text-xs text-muted-foreground" data-testid={`${testId}-status-message`}>
            {statusMessage}
          </p>
        )}
        {explainability && explainability.length > 0 && (
          <div className="space-y-1 border-t pt-2">
            {explainability.slice(0, 2).map((item, index) => (
              <p
                key={`${item.label}-${index}`}
                className="text-xs text-muted-foreground"
                data-testid={`${testId}-explainability-${index}`}
              >
                {item.label}: {item.detail}
              </p>
            ))}
          </div>
        )}
        {(onEdit || onDelete) && (
          <div className="flex gap-2 border-t pt-2">
            {onEdit && (
              <Button variant="outline" size="sm" onClick={onEdit} data-testid={`${testId}-edit`}>
                Edit
              </Button>
            )}
            {onDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} data-testid={`${testId}-delete`}>
                Delete
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
