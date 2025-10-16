import { ChatBubble } from "../ChatBubble";

export default function ChatBubbleExample() {
  return (
    <div className="space-y-4 p-4">
      <ChatBubble message="How can I reduce my expenses?" isUser={true} testId="msg-1" />
      <ChatBubble
        message="I can help you analyze your spending patterns and suggest areas where you can cut costs."
        isUser={false}
        testId="msg-2"
      />
    </div>
  );
}
