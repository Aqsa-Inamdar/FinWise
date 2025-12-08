import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send } from "lucide-react";
import { ChatBubble } from "./ChatBubble";

interface Message {
  id: string;
  text: string;
  isUser: boolean;
}

export function AIAssistantChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hello! I'm your FinWise AI assistant. I can help you understand your spending patterns, suggest savings strategies, and answer questions about your finances. How can I help you today?",
      isUser: false,
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const conversationLabelId = useId();
  const conversationDescriptionId = useId();

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const newUserMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      isUser: true,
    };

    setMessages((prev) => [...prev, newUserMessage]);
    setInputValue("");

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        text: "I understand your question. Based on your spending data, I can help you with that. Let me analyze your finances and provide personalized recommendations.",
        isUser: false,
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 1000);
  };

  return (
    <Card className="flex h-full flex-col">
      <section
        aria-labelledby={conversationLabelId}
        aria-describedby={conversationDescriptionId}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className="flex-1 space-y-4 overflow-y-auto p-4"
        data-testid="chat-messages"
      >
        <h2 id={conversationLabelId} className="sr-only">
          AI assistant conversation
        </h2>
        <p id={conversationDescriptionId} className="sr-only">
          Latest messages appear at the bottom. New responses are announced automatically.
        </p>
        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            message={message.text}
            isUser={message.isUser}
            testId={`message-${message.id}`}
          />
        ))}
      </section>
      <form
        className="border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        aria-label="Send a chat message"
      >
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask me anything about your finances..."
            className="flex-1"
            data-testid="input-chat"
            aria-label="Chat message input"
          />
          <Button
            type="submit"
            size="icon"
            data-testid="button-send"
            aria-label="Send message"
            disabled={!inputValue.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </Card>
  );
}
