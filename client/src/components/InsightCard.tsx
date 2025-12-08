import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface InsightCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  value?: string;
  testId?: string;
}

export function InsightCard({ title, description, icon: Icon, value, testId }: InsightCardProps) {
  return (
    <Card className="hover-elevate" data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <div className="rounded-md bg-primary/10 p-2" aria-hidden="true">
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" focusable="false" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{description}</p>
        {value && (
          <p className="font-mono text-2xl font-bold" data-testid={`${testId}-value`}>
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
