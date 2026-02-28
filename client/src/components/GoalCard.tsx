import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface GoalCardProps {
  title: string;
  current: number;
  target: number;
  deadline: string;
  status: "on-track" | "approaching" | "behind";
  probabilityAchievableByDeadline?: number | null;
  projectedCompletionDate?: string | null;
  statusMessage?: string | null;
  explainability?: Array<{ label: string; impact: "positive" | "negative" | "neutral"; detail: string }>;
  testId?: string;
}

export function GoalCard({
  title,
  current,
  target,
  deadline,
  status,
  probabilityAchievableByDeadline,
  projectedCompletionDate,
  statusMessage,
  explainability,
  testId,
}: GoalCardProps) {
  const percentage = Math.min((current / target) * 100, 100);
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
          {`${title} is ${Math.round(percentage)} percent funded. $${current.toLocaleString()} saved toward a goal of $${target.toLocaleString()} due by ${deadline}. Current status: ${statusConfig[status].label}.`}
        </p>
        <div className="flex items-end justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="font-mono text-lg font-semibold" data-testid={`${testId}-current`}>
              ${current.toLocaleString()}
            </p>
          </div>
          <div className="space-y-1 text-right">
            <p className="text-xs text-muted-foreground">Goal</p>
            <p className="font-mono text-lg font-semibold text-muted-foreground" data-testid={`${testId}-target`}>
              ${target.toLocaleString()}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-deadline`}>
          Deadline: {deadline}
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
      </CardContent>
    </Card>
  );
}
