import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ChatBubble } from "./ChatBubble";
import { apiRequest, getAuthHeader } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type AssistantSection = {
  title: string;
  points: string[];
};

type AssistantResponse = {
  intent: "descriptive" | "predictive";
  subIntent: string;
  confidence: "low" | "medium" | "high";
  answerSummary: string;
  sections: AssistantSection[];
  evidence: Array<{ label: string; value: string }>;
  suggestions: string[];
};

type MessageRecord = {
  id: string;
  role: "user" | "assistant";
  text: string;
  payload?: AssistantResponse | null;
  createdAt: string;
};

type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
};

type GoalOption = {
  id: string;
  name: string;
};

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);
const FALLBACK_QUICK_INTENTS = [
  "Which month did I spend the most?",
  "What are my top expense categories?",
  "What will my savings look like in 6 months?",
];

const parseJsonSafely = async (res: Response) => {
  const raw = await res.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `Unexpected response format (status ${res.status}). If you just updated backend routes, restart the dev server.`,
    );
  }
};

const confidenceColor = (c: AssistantResponse["confidence"]) => {
  if (c === "high") return "text-emerald-600";
  if (c === "medium") return "text-amber-600";
  return "text-red-600";
};

export function AIAssistantChat() {
  const { toast } = useToast();

  const [question, setQuestion] = useState("");
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [endDate, setEndDate] = useState(toDateInput(new Date()));
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 90);
    return toDateInput(d);
  });
  const [selectedGoalId, setSelectedGoalId] = useState<string>("");
  const [quickIntents, setQuickIntents] = useState<string[]>([]);

  const { data: goalsData } = useQuery<{ goals: GoalOption[] }>({ queryKey: ["/api/goals"] });
  const goalOptions = goalsData?.goals ?? [];

  const loadChats = async () => {
    const authHeader = await getAuthHeader();
    const res = await fetch("/api/assistant/chats", { headers: authHeader, credentials: "include" });
    if (!res.ok) throw new Error("Failed to load chat threads");
    const json = await parseJsonSafely(res);
    const nextChats = (json.chats ?? []) as ChatThread[];
    setChats(nextChats);

    if (!activeChatId && nextChats.length) {
      setActiveChatId(nextChats[0].id);
    }
  };

  const loadMessages = async (chatId: string) => {
    const authHeader = await getAuthHeader();
    const res = await fetch(`/api/assistant/chats/${chatId}/messages`, {
      headers: authHeader,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to load messages");
    const json = await parseJsonSafely(res);
    setMessages((json.messages ?? []) as MessageRecord[]);
  };

  const loadQuickIntents = async () => {
    const authHeader = await getAuthHeader();
    const params = new URLSearchParams({ startDate, endDate });
    const res = await fetch(`/api/assistant/quick-intents?${params.toString()}`, {
      headers: authHeader,
      credentials: "include",
    });
    if (!res.ok) {
      setQuickIntents(FALLBACK_QUICK_INTENTS);
      return;
    }
    const json = await parseJsonSafely(res);
    const intents = (json.intents ?? []) as string[];
    setQuickIntents(intents.length ? intents : FALLBACK_QUICK_INTENTS);
  };

  useEffect(() => {
    loadChats().catch(() => {
      toast({ title: "Assistant", description: "Unable to load chat history.", variant: "destructive" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    loadMessages(activeChatId).catch(() => {
      toast({ title: "Assistant", description: "Unable to load chat messages.", variant: "destructive" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  useEffect(() => {
    loadQuickIntents().catch(() => {
      setQuickIntents(FALLBACK_QUICK_INTENTS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const createNewChat = async () => {
    try {
      const res = await apiRequest("POST", "/api/assistant/chats", { title: "New Chat" });
      const json = await res.json();
      const chatId = json.chatId as string;
      setActiveChatId(chatId);
      setMessages([]);
      setQuestion("");
      await loadChats();
    } catch {
      toast({ title: "Assistant", description: "Unable to create a new chat.", variant: "destructive" });
    }
  };

  const deleteChat = async (chatId: string) => {
    try {
      await apiRequest("DELETE", `/api/assistant/chats/${chatId}`);
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
      }
      await loadChats();
    } catch {
      toast({ title: "Assistant", description: "Unable to delete chat.", variant: "destructive" });
    }
  };

  const askQuestion = async (asked: string) => {
    if (!asked.trim()) return;
    if (!startDate || !endDate) {
      toast({ title: "Assistant", description: "Select start and end dates first.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/assistant/query", {
        question: asked.trim(),
        startDate,
        endDate,
        selectedGoalId: selectedGoalId || null,
        chatId: activeChatId,
      });
      const json = await res.json();
      const chatId = json.chatId as string;
      setActiveChatId(chatId);
      setQuestion("");
      await Promise.all([loadChats(), loadMessages(chatId)]);
    } catch (error: any) {
      toast({ title: "Assistant", description: error?.message ?? "Query failed.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderAssistantPayload = (payload?: AssistantResponse | null) => {
    if (!payload) return null;
    return (
      <div className="mt-2 rounded border bg-background p-3 text-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-medium">Intent: {payload.intent}</span>
          <span>Sub-intent: {payload.subIntent}</span>
          <span className={confidenceColor(payload.confidence)}>Confidence: {payload.confidence}</span>
        </div>

        {payload.sections.map((section, idx) => (
          <div key={`${section.title}-${idx}`} className="space-y-1">
            <p className="font-medium">{section.title}</p>
            {section.points.map((point, pIdx) => (
              <p key={`${section.title}-${pIdx}`} className="text-muted-foreground">- {point}</p>
            ))}
          </div>
        ))}

        {payload.evidence.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Evidence</p>
            {payload.evidence.map((item, idx) => (
              <p key={`${item.label}-${idx}`} className="text-muted-foreground">
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        )}

        {payload.suggestions.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium">Suggested next questions</p>
            {payload.suggestions.slice(0, 3).map((item, idx) => (
              <p key={`${item}-${idx}`} className="text-muted-foreground">- {item}</p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const activeChatTitle = useMemo(
    () => chats.find((c) => c.id === activeChatId)?.title ?? "New Chat",
    [chats, activeChatId],
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
      <Card className="flex min-h-0 flex-col p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Chats</p>
          <Button size="sm" onClick={createNewChat}>New Chat</Button>
        </div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {chats.map((chat) => (
            <div key={chat.id} className="rounded border p-2">
              <button
                className={`w-full text-left text-sm ${activeChatId === chat.id ? "font-semibold" : ""}`}
                onClick={() => setActiveChatId(chat.id)}
              >
                {chat.title || "Untitled"}
              </button>
              <p className="text-xs text-muted-foreground line-clamp-2">{chat.lastMessagePreview || "No messages yet"}</p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    const ok = window.confirm("Delete this chat permanently?");
                    if (ok) deleteChat(chat.id);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {!chats.length && <p className="text-xs text-muted-foreground">No chat history yet.</p>}
        </div>
      </Card>

      <Card className="flex h-full min-h-0 flex-col">
        <div className="border-b p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{activeChatTitle}</p>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-xs text-muted-foreground">Start</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px]" />
              <label className="text-xs text-muted-foreground">End</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px]" />
              <select
                value={selectedGoalId}
                onChange={(e) => setSelectedGoalId(e.target.value)}
                className="h-9 rounded-md border px-2 text-sm"
              >
                <option value="">No goal selected</option>
                {goalOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>

          {quickIntents.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickIntents.map((intent, idx) => (
                <Button key={`${intent}-${idx}`} variant="outline" size="sm" onClick={() => askQuestion(intent)}>
                  {intent}
                </Button>
              ))}
            </div>
          )}
        </div>

        <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" role="log" aria-live="polite">
          {messages.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Ask a question to get a structured financial report.
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id}>
              <ChatBubble
                message={message.text}
                isUser={message.role === "user"}
                testId={`message-${message.id}`}
              />
              {message.role === "assistant" && renderAssistantPayload(message.payload ?? null)}
            </div>
          ))}
        </section>

        <form
          className="border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            askQuestion(question);
          }}
        >
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a financial question for this date range..."
              className="flex-1"
              data-testid="input-chat"
            />
            <Button type="submit" disabled={!question.trim() || isSubmitting} data-testid="button-send">
              {isSubmitting ? "Analyzing..." : "Send"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
