import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot, User } from "lucide-react";

interface ChatBubbleProps {
  message: string;
  isUser: boolean;
  testId?: string;
}

export function ChatBubble({ message, isUser, testId }: ChatBubbleProps) {
  const speakerLabel = isUser ? "You" : "FinWise assistant";

  return (
    <div
      className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
      data-testid={testId}
      role="group"
      aria-roledescription="Chat message"
    >
      <Avatar className="h-8 w-8" aria-hidden="true">
        <AvatarFallback className={cn(isUser ? "bg-primary text-primary-foreground" : "bg-muted")}>
          {isUser ? <User className="h-4 w-4" aria-hidden="true" focusable="false" /> : <Bot className="h-4 w-4" aria-hidden="true" focusable="false" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-4 py-2",
          isUser ? "bg-primary text-primary-foreground" : "border bg-card"
        )}
      >
        <span className="sr-only">{speakerLabel} said:</span>
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
