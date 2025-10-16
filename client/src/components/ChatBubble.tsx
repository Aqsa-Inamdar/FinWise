import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot, User } from "lucide-react";

interface ChatBubbleProps {
  message: string;
  isUser: boolean;
  testId?: string;
}

export function ChatBubble({ message, isUser, testId }: ChatBubbleProps) {
  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
      data-testid={testId}
    >
      <Avatar className="h-8 w-8">
        <AvatarFallback className={cn(isUser ? "bg-primary text-primary-foreground" : "bg-muted")}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-4 py-2",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border bg-card"
        )}
      >
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
