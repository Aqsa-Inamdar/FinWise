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
  testId?: string;
}

export function GoalCard({ title, current, target, deadline, status, testId }: GoalCardProps) {
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
      </CardContent>
    </Card>
  );
}
