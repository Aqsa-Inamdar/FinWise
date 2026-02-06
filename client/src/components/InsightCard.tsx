import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LucideIcon, ChevronDown } from "lucide-react";

interface InsightCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  value?: string;
  reasoning?: string[];
  reasoningTitle?: string;
  testId?: string;
}

export function InsightCard({
  title,
  description,
  icon: Icon,
  value,
  reasoning,
  reasoningTitle = "Why am I seeing this?",
  testId,
}: InsightCardProps) {
  const hasReasoning = Boolean(reasoning && reasoning.length);
  const cardBody = (
    <Card className="hover-elevate" data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-2" aria-hidden="true">
            <Icon className="h-5 w-5 text-primary" aria-hidden="true" focusable="false" />
          </div>
          {hasReasoning && (
            <ChevronDown
              className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          )}
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

  if (!hasReasoning) {
    return cardBody;
  }

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button type="button" className="group w-full text-left">
          {cardBody}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="rounded-b-lg border border-t-0 px-6 pb-4 pt-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{reasoningTitle}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {reasoning?.map((item, index) => (
            <li key={`${title}-reason-${index}`}>{item}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
