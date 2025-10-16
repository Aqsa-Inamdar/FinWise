import { AIAssistantChat } from "@/components/AIAssistantChat";

export default function Assistant() {
  return (
    <div className="flex h-full flex-col space-y-4">
      <div>
        <h1 className="text-3xl font-light tracking-tight" data-testid="text-assistant-title">
          AI Financial Assistant
        </h1>
        <p className="text-sm text-muted-foreground">
          Get personalized financial advice and insights
        </p>
      </div>
      <div className="flex-1">
        <AIAssistantChat />
      </div>
    </div>
  );
}
