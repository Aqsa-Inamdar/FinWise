import { firestore } from "../firebaseAdmin";
import {
  allocateGoalsByDeadline,
  buildGoalProjection,
  fetchGoals,
  fetchUserNetSavings,
} from "./goalProjection";
import OpenAI from "openai";

export type AssistantIntent = "descriptive" | "predictive" | "prescriptive";
export type ConfidenceLabel = "low" | "medium" | "high";

export type AssistantSection = {
  title: string;
  points: string[];
};

export type AssistantResponse = {
  intent: AssistantIntent;
  subIntent: string;
  confidence: ConfidenceLabel;
  answerSummary: string;
  sections: AssistantSection[];
  evidence: Array<{ label: string; value: string }>;
  suggestions: string[];
};

type AssistantNarration = Pick<AssistantResponse, "answerSummary" | "sections" | "suggestions">;
type SuggestionRefinement = { suggestions: string[] };

export type TxnRecord = {
  date: string;
  category: string;
  amount: number | string;
  type: "income" | "expense";
};

type ChatContextMessage = {
  role: "user" | "assistant";
  text: string;
};

type ScenarioContext = {
  metric: "savings" | "income" | "expense";
  horizonMonths: number;
  direction?: "increase" | "decrease";
  pct?: number;
};

type PromptPlan = {
  intent: AssistantIntent;
  subIntent: string;
  metric?: "savings" | "income" | "expense";
  horizonMonths?: number;
  scenario?: {
    direction: "increase" | "decrease";
    pct: number;
    metric: "savings" | "income" | "expense";
  } | null;
  useSelectedGoal: boolean;
  needsClarification: boolean;
  clarificationQuestion?: string;
};

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const countOverlap = (tokens: string[], vocab: string[]) => {
  const set = new Set(tokens);
  return vocab.reduce((acc, item) => acc + (set.has(item) ? 1 : 0), 0);
};

const hasStrongDescriptiveSignal = (question: string) => {
  const q = question.toLowerCase();
  return (
    /\b(which|what|show)\b.*\bmonth\b.*\b(spend|spending|expense)\b/.test(q) ||
    /\b(highest|most|max|lowest|least|min)\b.*\b(spend|spending|expense)\b.*\bmonth\b/.test(q) ||
    /\bhow much\b.*\bspend\b.*\bon\b/.test(q) ||
    /\b(unusual|anomaly|anomalous|outlier|spike)\b.*\bmonth\b/.test(q) ||
    /\btop\b.*\b(category|categories)\b/.test(q)
  );
};

const detectIntent = (question: string): { intent: AssistantIntent; subIntent: string; confidenceHint: number } => {
  const q = question.toLowerCase();
  const tokens = tokenize(q);

  // Hard intent overrides to avoid misrouting clear descriptive prompts.
  if (
    /\bwhich month\b.*\b(spend|spending|expense)\b.*\b(most|highest|max)\b|\b(most|highest|max)\b.*\bmonth\b.*\b(spend|spending|expense)\b|\b(most|highest|max)\b.*\b(spend|spending|expense)\b.*\bmonth\b/.test(
      q,
    )
  ) {
    return { intent: "descriptive", subIntent: "max_spend_month", confidenceHint: 0.98 };
  }
  if (
    /\bwhich month\b.*\b(spend|spending|expense)\b.*\b(least|lowest|min)\b|\b(least|lowest|min)\b.*\bmonth\b.*\b(spend|spending|expense)\b|\b(least|lowest|min)\b.*\b(spend|spending|expense)\b.*\bmonth\b/.test(
      q,
    )
  ) {
    return { intent: "descriptive", subIntent: "min_spend_month", confidenceHint: 0.98 };
  }
  if (/\btop\b.*\b(category|categories)\b|\b(category|categories)\b.*\btop\b/.test(q)) {
    return { intent: "descriptive", subIntent: "top_categories", confidenceHint: 0.95 };
  }
  if (/\bhow much\b.*\bspend\b.*\bon\b/.test(q)) {
    return { intent: "descriptive", subIntent: "category_spend", confidenceHint: 0.95 };
  }
  if (/\b(unusual|anomaly|anomalous|outlier|spike)\b.*\bmonth\b|\bwhich month\b.*\b(unusual|anomaly|outlier)\b/.test(q)) {
    return { intent: "descriptive", subIntent: "unusual_month", confidenceHint: 0.95 };
  }
  if (/\b(how can i|what should i|tips to|ways to)\b.*\b(save|savings|increase savings)\b/.test(q)) {
    return { intent: "prescriptive", subIntent: "savings_improvement", confidenceHint: 0.92 };
  }

  // Strong lexical overrides for forecast entity so expense/income prompts
  // do not fall back to savings forecast.
  const hasIncome = /\bincome\b|\bearn(ings)?\b|\bsalary\b/.test(q);
  const hasExpense = /\bexpense(s)?\b|\bspend(ing)?\b|\bcost(s)?\b/.test(q);
  const hasSavings = /\bsaving(s)?\b|\bnet savings?\b/.test(q);
  const hasForecastLike = /\bforecast\b|\bpredict\b|\blook like\b|\bnext\b|\bmonth(s)?\b|\bfuture\b/.test(q);

  if (hasForecastLike) {
    if (hasExpense && !hasSavings && !hasIncome) {
      return { intent: "predictive", subIntent: "expense_forecast", confidenceHint: 0.9 };
    }
    if (hasIncome && !hasSavings) {
      return { intent: "predictive", subIntent: "income_forecast", confidenceHint: 0.9 };
    }
    if (hasSavings && !hasIncome && !hasExpense) {
      return { intent: "predictive", subIntent: "savings_forecast", confidenceHint: 0.9 };
    }
  }

  const descriptiveRules: Array<{ subIntent: string; keywords: string[] }> = [
    { subIntent: "max_spend_month", keywords: ["most", "highest", "max", "month", "spend"] },
    { subIntent: "min_spend_month", keywords: ["least", "lowest", "min", "month", "spend"] },
    { subIntent: "category_spend", keywords: ["how", "much", "spend", "on"] },
    { subIntent: "unusual_month", keywords: ["unusual", "anomaly", "outlier", "spike", "month"] },
    { subIntent: "top_categories", keywords: ["top", "category", "categories", "expense"] },
    { subIntent: "spending_patterns", keywords: ["pattern", "patterns", "trend", "spending"] },
    { subIntent: "monthly_summary", keywords: ["summary", "month", "spending", "income", "expense"] },
  ];

  const predictiveRules: Array<{ subIntent: string; keywords: string[] }> = [
    { subIntent: "goal_eta", keywords: ["when", "reach", "goal"] },
    { subIntent: "goal_deadline", keywords: ["hit", "target", "deadline", "by"] },
    { subIntent: "savings_forecast", keywords: ["savings", "look", "months", "forecast"] },
    { subIntent: "income_forecast", keywords: ["income", "forecast", "predict"] },
    { subIntent: "expense_forecast", keywords: ["expense", "spending", "forecast", "predict"] },
  ];

  let bestDescriptive = { subIntent: "general_descriptive", score: 0 };
  for (const rule of descriptiveRules) {
    const score = countOverlap(tokens, rule.keywords);
    if (score > bestDescriptive.score) {
      bestDescriptive = { subIntent: rule.subIntent, score };
    }
  }

  let bestPredictive = { subIntent: "general_predictive", score: 0 };
  for (const rule of predictiveRules) {
    const score = countOverlap(tokens, rule.keywords);
    if (score > bestPredictive.score) {
      bestPredictive = { subIntent: rule.subIntent, score };
    }
  }

  const bestIntent: AssistantIntent =
    bestPredictive.score > bestDescriptive.score ? "predictive" : "descriptive";
  const bestScore = Math.max(bestPredictive.score, bestDescriptive.score);
  const bestSubIntent =
    bestIntent === "predictive" ? bestPredictive.subIntent : bestDescriptive.subIntent;

  // Fallback pseudo-ML scorer with prototype phrases.
  if (bestScore <= 1) {
    const proto: Record<AssistantIntent, string[]> = {
      descriptive: [
        "which month did i spend most",
        "top categories",
        "spending pattern",
        "least spending month",
      ],
      predictive: [
        "will i hit goal by deadline",
        "when will i reach goal",
        "savings in 6 months",
        "future expense forecast",
      ],
      prescriptive: [
        "how can i increase my savings",
        "what should i reduce",
        "how to save more each month",
      ],
    };

    const qTokens = tokenize(q);
    const scoreByIntent = (intent: AssistantIntent) => {
      return proto[intent]
        .map((p) => {
          const pTokens = tokenize(p);
          const overlap = countOverlap(qTokens, pTokens);
          return overlap / Math.max(1, pTokens.length);
        })
        .reduce((a, b) => Math.max(a, b), 0);
    };

    const d = scoreByIntent("descriptive");
    const p = scoreByIntent("predictive");
    const r = scoreByIntent("prescriptive");
    if (r > Math.max(d, p)) {
      return { intent: "prescriptive", subIntent: "savings_improvement", confidenceHint: r };
    }
    if (p > d) {
      return { intent: "predictive", subIntent: "general_predictive", confidenceHint: p };
    }
    return { intent: "descriptive", subIntent: "general_descriptive", confidenceHint: d };
  }

  return {
    intent: bestIntent,
    subIntent: bestSubIntent,
    confidenceHint: Math.min(1, bestScore / 4),
  };
};

const isGeneralFinanceGuidanceQuestion = (question: string) => {
  const q = question.toLowerCase();
  return /\bbudget\b|\bdebt\b|\bloan\b|\binvest\b|\bcredit score\b|\bemergency fund\b|\bretirement\b|\btax\b|\binsurance\b|\bsave more\b/.test(
    q,
  );
};

const isStandaloneQuestion = (question: string) => {
  const q = question.toLowerCase().trim();
  if (!q) return true;
  if (/^(which|what|how|when|where|who)\b/.test(q)) return true;
  if (/\b(top categories|which month|forecast|spend the most|spend the least)\b/.test(q)) return true;
  return false;
};

const shouldContextualizeQuestion = (question: string) => {
  const q = question.toLowerCase();
  if (isStandaloneQuestion(q)) return false;
  return /\b(that|this|those|it|same|also|instead|baseline|what about|and)\b/.test(q);
};

const isBaselineWithoutScenarioQuestion = (question: string) =>
  /\bbaseline\b.*\b(without|no)\b.*\bscenario\b|\bwithout\b.*\bscenario\b|\bback to baseline\b/.test(
    question.toLowerCase(),
  );

const toAmount = (value: string | number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const monthKey = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const toConfidenceLabel = (probability: number): ConfidenceLabel => {
  if (probability >= 0.75) return "high";
  if (probability >= 0.55) return "medium";
  return "low";
};

const confidenceScore = (label: ConfidenceLabel) => {
  if (label === "high") return 0.85;
  if (label === "medium") return 0.65;
  return 0.45;
};

const messageLimit = 100;
const threadLimit = 40;

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const narrationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answerSummary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          points: { type: "array", items: { type: "string" } },
        },
        required: ["title", "points"],
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: ["answerSummary", "sections", "suggestions"],
} as const;

const suggestionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: ["suggestions"],
} as const;

const contextualQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolvedQuestion: { type: "string" },
  },
  required: ["resolvedQuestion"],
} as const;

const plannerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["descriptive", "predictive", "prescriptive"] },
    subIntent: { type: "string" },
    metric: { type: "string", enum: ["savings", "income", "expense"] },
    horizonMonths: { type: "number" },
    scenario: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            direction: { type: "string", enum: ["increase", "decrease"] },
            pct: { type: "number" },
            metric: { type: "string", enum: ["savings", "income", "expense"] },
          },
          required: ["direction", "pct", "metric"],
        },
      ],
    },
    useSelectedGoal: { type: "boolean" },
    needsClarification: { type: "boolean" },
    clarificationQuestion: { type: "string" },
  },
  required: [
    "intent",
    "subIntent",
    "scenario",
    "useSelectedGoal",
    "needsClarification",
    "clarificationQuestion",
  ],
} as const;

const redactForLlm = (text: string) =>
  text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b\d{12,19}\b/g, "[redacted-account]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, "[redacted-phone]")
    .slice(0, 800);

const narrateWithLlm = async (
  base: AssistantResponse,
  question: string,
): Promise<AssistantNarration | null> => {
  if (!openaiClient) return null;
  try {
    const safeQuestion = redactForLlm(question);
    const completionPromise = openaiClient.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are a financial explainer. Rewrite the provided deterministic result into plain language. " +
            "Do not invent numbers, assumptions, or metrics. Use only values present in the input JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question: safeQuestion,
            deterministic_result: base,
            style: "plain-language rich report",
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "assistant_narration",
          schema: narrationSchema,
          strict: true,
        },
      },
      max_output_tokens: 700,
    });
    const response = await Promise.race([
      completionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);
    if (!response) return null;

    const raw = response.output_text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssistantNarration;
    if (
      typeof parsed.answerSummary !== "string" ||
      !Array.isArray(parsed.sections) ||
      !Array.isArray(parsed.suggestions)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const refineSuggestionsWithLlm = async (
  question: string,
  candidates: string[],
): Promise<string[] | null> => {
  if (!openaiClient || !candidates.length) return null;
  try {
    const safeQuestion = redactForLlm(question);
    const completionPromise = openaiClient.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You improve follow-up user questions for a financial assistant. " +
            "You must only rewrite or select from provided candidates. " +
            "Do not introduce new analytics that were not in the candidates.",
        },
        {
          role: "user",
          content: JSON.stringify({
            user_question: safeQuestion,
            candidate_followups: candidates.map((c) => redactForLlm(c)),
            instruction: "Return at most 5 concise, diverse suggestions.",
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "suggestion_refinement",
          schema: suggestionSchema,
          strict: true,
        },
      },
      max_output_tokens: 250,
    });
    const response = await Promise.race([
      completionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1300)),
    ]);
    if (!response) return null;
    const raw = response.output_text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SuggestionRefinement;
    if (!Array.isArray(parsed.suggestions)) return null;
    const cleaned = parsed.suggestions
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 5);
    return cleaned.length ? cleaned : null;
  } catch {
    return null;
  }
};

const contextualizeQuestionWithLlm = async (
  question: string,
  chatHistory: ChatContextMessage[],
): Promise<string | null> => {
  if (!openaiClient) return null;
  if (!chatHistory.length) return null;
  try {
    const safeQuestion = redactForLlm(question);
    const completionPromise = openaiClient.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "Convert follow-up financial questions into a standalone question using chat history. " +
            "Do not answer the question. Keep wording concise and preserve user intent.",
        },
        {
          role: "user",
          content: JSON.stringify({
            latest_question: safeQuestion,
            recent_chat: chatHistory.slice(-6).map((m) => ({ role: m.role, text: redactForLlm(m.text) })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "contextual_query",
          schema: contextualQuerySchema,
          strict: true,
        },
      },
      max_output_tokens: 150,
    });

    const response = await Promise.race([
      completionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1300)),
    ]);
    if (!response) return null;
    const raw = response.output_text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { resolvedQuestion?: string };
    const resolved = String(parsed.resolvedQuestion ?? "").trim();
    return resolved || null;
  } catch {
    return null;
  }
};

const planPromptWithLlm = async (params: {
  question: string;
  chatHistory: ChatContextMessage[];
  selectedGoalId: string | null;
  startDate: string;
  endDate: string;
}): Promise<PromptPlan | null> => {
  if (!openaiClient) return null;
  const { question, chatHistory, selectedGoalId, startDate, endDate } = params;
  try {
    const completionPromise = openaiClient.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are a planner for a financial assistant. Return only execution instructions in JSON. " +
            "Do not answer the user question. Prefer deterministic analytics intents.",
        },
        {
          role: "user",
          content: JSON.stringify({
            user_question: redactForLlm(question),
            recent_chat: chatHistory.slice(-6).map((m) => ({ role: m.role, text: redactForLlm(m.text) })),
            selected_goal_provided: Boolean(selectedGoalId),
            available_intents: ["descriptive", "predictive", "prescriptive"],
            date_range: { startDate, endDate },
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "prompt_plan",
          schema: plannerSchema,
          strict: true,
        },
      },
      max_output_tokens: 220,
    });
    const response = await Promise.race([
      completionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1400)),
    ]);
    if (!response) return null;
    const raw = response.output_text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PromptPlan;
    return {
      ...parsed,
      horizonMonths:
        parsed.horizonMonths != null ? Math.max(1, Math.min(36, Math.round(parsed.horizonMonths))) : undefined,
      scenario:
        parsed.scenario && Number.isFinite(parsed.scenario.pct)
          ? {
              ...parsed.scenario,
              pct: Math.max(0, Math.min(100, parsed.scenario.pct)),
            }
          : null,
      clarificationQuestion: String(parsed.clarificationQuestion ?? "").trim(),
    };
  } catch {
    return null;
  }
};

const parseHorizonMonths = (question: string): number => {
  const m = question.toLowerCase().match(/(\d+)\s*month/);
  if (!m) return 6;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 6;
  return Math.max(1, Math.min(36, n));
};

const parseScenarioAdjustment = (question: string): {
  detected: boolean;
  metric: "savings" | "income" | "expense";
  direction: "increase" | "decrease";
  pct: number;
} => {
  const q = question.toLowerCase();
  const pctMatch = q.match(/(\d+(?:\.\d+)?)\s*%/);
  const pct = pctMatch ? Number(pctMatch[1]) : 0;
  const metric: "savings" | "income" | "expense" =
    q.includes("income") ? "income" : q.includes("expense") || q.includes("spend") ? "expense" : "savings";
  const direction: "increase" | "decrease" = q.includes("decrease") || q.includes("reduce") ? "decrease" : "increase";
  const detected =
    pct > 0 &&
    (q.includes("what if") ||
      q.includes("if my") ||
      q.includes("increase") ||
      q.includes("decrease") ||
      q.includes("reduce"));
  return {
    detected,
    metric,
    direction,
    pct: Math.min(100, Math.max(0, pct)),
  };
};

const inferForecastMetric = (question: string): "savings" | "income" | "expense" => {
  const q = question.toLowerCase();
  if (/\bincome\b|\bsalary\b|\bearn/.test(q)) return "income";
  if (/\bexpense\b|\bspend\b|\bcost/.test(q)) return "expense";
  return "savings";
};

const findLastScenarioContext = (chatHistory: ChatContextMessage[]): ScenarioContext | null => {
  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const msg = chatHistory[i];
    if (msg.role !== "user") continue;
    const scenario = parseScenarioAdjustment(msg.text);
    const metric = inferForecastMetric(msg.text);
    const horizonMonths = parseHorizonMonths(msg.text);
    if (scenario.detected) {
      return {
        metric: scenario.metric,
        horizonMonths,
        direction: scenario.direction,
        pct: scenario.pct,
      };
    }
    if (/\bforecast\b|\blook like\b|\bnext\b|\bmonth/.test(msg.text.toLowerCase())) {
      return { metric, horizonMonths };
    }
  }
  return null;
};

const fetchTransactionsInRange = async (userId: string, startDate: string, endDate: string) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range");
  }

  const snapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("transactions")
    .where("date", ">=", start.toISOString())
    .where("date", "<=", end.toISOString())
    .orderBy("date", "asc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as TxnRecord);
};

const monthlyTotals = (txns: TxnRecord[]) => {
  const monthMap = new Map<string, { income: number; expense: number }>();
  txns.forEach((t) => {
    const mk = monthKey(t.date);
    if (!mk) return;
    const entry = monthMap.get(mk) ?? { income: 0, expense: 0 };
    const amt = toAmount(t.amount);
    if (t.type === "income") entry.income += amt;
    if (t.type === "expense") entry.expense += amt;
    monthMap.set(mk, entry);
  });
  return Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, income: v.income, expense: v.expense, savings: v.income - v.expense }));
};

const topCategories = (txns: TxnRecord[]) => {
  const map = new Map<string, number>();
  txns
    .filter((t) => t.type === "expense")
    .forEach((t) => map.set(t.category || "Uncategorized", (map.get(t.category || "Uncategorized") ?? 0) + toAmount(t.amount)));

  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({ category, amount }));
};

const dedupeSuggestions = (items: string[]) => Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));

const simplifyDirectAnswerText = (summary: string) => {
  const s = summary.trim();
  let m =
    s.match(
      /^If current trend continues, projected cumulative (savings|income|expenses) in (\d+) months is \$([-\d.,]+)\.?$/i,
    );
  if (m) {
    return `At your current pace, your ${m[1].toLowerCase()} in the next ${m[2]} months is about $${m[3]}.`;
  }

  m = s.match(
    /^Under this scenario .* projected cumulative savings in (\d+) months is \$([-\d.,]+) \(baseline \$([-\d.,]+)\)\.?$/i,
  );
  if (m) {
    return `With this change, your estimated savings in ${m[1]} months is about $${m[2]} (baseline: $${m[3]}).`;
  }

  m = s.match(/^For goal "([^"]+)", you are (.+) with probability ([\d.]+)%\.?$/i);
  if (m) {
    return `For "${m[1]}", status is ${m[2]}. Chance to hit by deadline: ${m[3]}%.`;
  }

  m = s.match(/^For goal "([^"]+)", you need about \$([-\d.,]+)\/month more savings to stay on deadline\.?$/i);
  if (m) {
    return `For "${m[1]}", you need about $${m[2]} more savings each month to stay on track.`;
  }

  return s;
};

const applySimpleDirectAnswer = (response: AssistantResponse): AssistantResponse => {
  const simple = simplifyDirectAnswerText(response.answerSummary);
  const sections = response.sections.map((section) => {
    if (section.title.toLowerCase() !== "direct answer") return section;
    return {
      ...section,
      points: section.points.length ? [simple, ...section.points.slice(1)] : [simple],
    };
  });

  return {
    ...response,
    answerSummary: simple,
    sections,
  };
};

const buildDescriptiveSuggestions = (params: {
  monthly: Array<{ month: string; income: number; expense: number; savings: number }>;
  categories: Array<{ category: string; amount: number }>;
  subIntent: string;
}) => {
  const { monthly, categories, subIntent } = params;
  const topCategory = categories[0]?.category;
  const secondCategory = categories[1]?.category;
  const highestMonth = monthly.length ? [...monthly].sort((a, b) => b.expense - a.expense)[0]?.month : null;
  const lowestMonth = monthly.length ? [...monthly].sort((a, b) => a.expense - b.expense)[0]?.month : null;

  const suggestions = [
    "Forecast my savings for the next 6 months.",
    "Which month was unusual and why?",
    "Show my highest spending month in this range.",
  ];

  if (topCategory) suggestions.push(`How much do I spend on ${topCategory} in this range?`);
  if (secondCategory) suggestions.push(`Compare my spend on ${topCategory} vs ${secondCategory}.`);
  if (highestMonth) suggestions.push(`Why was my spending high in ${highestMonth}?`);
  if (lowestMonth) suggestions.push(`Why was my spending low in ${lowestMonth}?`);
  if (subIntent !== "top_categories") suggestions.push("What are my top expense categories?");
  if (subIntent !== "max_spend_month") suggestions.push("Which month did I spend the most?");
  if (subIntent !== "min_spend_month") suggestions.push("Which month did I spend the least?");

  return dedupeSuggestions(suggestions).slice(0, 6);
};

const buildPredictiveSuggestions = (params: {
  monthly: Array<{ month: string; income: number; expense: number; savings: number }>;
  categories: Array<{ category: string; amount: number }>;
  selectedGoalName: string | null;
  horizon: number;
  forecastMetric: "savings" | "income" | "expense";
  scenarioDetected: boolean;
}) => {
  const { categories, selectedGoalName, horizon, forecastMetric, scenarioDetected } = params;
  const altHorizon = horizon === 6 ? 3 : 6;
  const topCategory = categories[0]?.category;
  const suggestions = [
    `What will my ${forecastMetric === "savings" ? "savings" : forecastMetric === "income" ? "income" : "expenses"} look like in ${altHorizon} months?`,
    "Which month did I spend the most in this range?",
  ];

  if (selectedGoalName) {
    suggestions.push(`Will I hit ${selectedGoalName} by its deadline?`);
    suggestions.push(`When will I reach ${selectedGoalName}?`);
  } else {
    suggestions.push("Will I hit my selected goal by its deadline?");
  }

  if (!scenarioDetected) {
    suggestions.push("What if my monthly savings increases by 10%?");
    suggestions.push("What if my monthly expenses decrease by 10%?");
  } else {
    suggestions.push("Show baseline forecast without scenario changes.");
  }

  if (topCategory) suggestions.push(`If I reduce ${topCategory} by 10%, how does my 6-month savings change?`);
  suggestions.push("What are my top expense categories?");

  return dedupeSuggestions(suggestions).slice(0, 6);
};

const buildGuidanceResponse = async (
  question: string,
  monthly: Array<{ month: string; income: number; expense: number; savings: number }>,
): Promise<AssistantResponse> => {
  const avgSavings = monthly.length ? monthly.reduce((s, m) => s + m.savings, 0) / monthly.length : 0;
  const avgExpense = monthly.length ? monthly.reduce((s, m) => s + m.expense, 0) / monthly.length : 0;
  const avgIncome = monthly.length ? monthly.reduce((s, m) => s + m.income, 0) / monthly.length : 0;

  const base: AssistantResponse = {
    intent: "descriptive",
    subIntent: "financial_guidance",
    confidence: monthly.length >= 3 ? "medium" : "low",
    answerSummary:
      "Here is practical financial guidance based on your question and the selected date-range behavior.",
    sections: [
      {
        title: "Practical Guidance",
        points: [
          "Use a monthly budget split for fixed needs, flexible wants, and savings first.",
          "Track one category to reduce this month and move that amount directly to savings.",
          "Set a weekly spending cap for discretionary categories to avoid end-of-month spikes.",
        ],
      },
      {
        title: "Your Current Baseline",
        points: [
          `Average monthly income: $${avgIncome.toFixed(2)}`,
          `Average monthly expenses: $${avgExpense.toFixed(2)}`,
          `Average monthly savings: $${avgSavings.toFixed(2)}`,
        ],
      },
    ],
    evidence: [
      { label: "Months analyzed", value: String(monthly.length) },
      { label: "Question", value: question },
    ],
    suggestions: [
      "What is one category I should cut first based on my data?",
      "If I reduce discretionary spend by 10%, how much more can I save in 6 months?",
      "Build a monthly budget target for me using this date range.",
    ],
  };

  if (!openaiClient) return base;
  try {
    const safeQuestion = redactForLlm(question);
    const completionPromise = openaiClient.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are a financial assistant. Provide practical, plain-language guidance. " +
            "Use provided user metrics only; do not invent numbers.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question: safeQuestion,
            user_metrics: {
              avgIncome,
              avgExpense,
              avgSavings,
              monthsAnalyzed: monthly.length,
            },
            format: "rich report with short actionable bullets",
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "assistant_narration",
          schema: narrationSchema,
          strict: true,
        },
      },
      max_output_tokens: 600,
    });
    const response = await Promise.race([
      completionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);
    if (!response) return base;
    const raw = response.output_text?.trim();
    if (!raw) return base;
    const parsed = JSON.parse(raw) as AssistantNarration;
    return {
      ...base,
      answerSummary: parsed.answerSummary || base.answerSummary,
      sections: Array.isArray(parsed.sections) && parsed.sections.length ? parsed.sections : base.sections,
      suggestions:
        Array.isArray(parsed.suggestions) && parsed.suggestions.length
          ? parsed.suggestions.slice(0, 5)
          : base.suggestions,
      confidence: monthly.length >= 3 ? "high" : "medium",
    };
  } catch {
    return base;
  }
};

const buildPrescriptiveSavingsResponse = async (
  userId: string,
  question: string,
  txns: TxnRecord[],
  selectedGoalId: string | null,
): Promise<AssistantResponse> => {
  const monthly = monthlyTotals(txns);
  const monthsAnalyzed = Math.max(1, monthly.length);
  const rawTopCategories = topCategories(txns);
  const avgIncome = monthly.length ? monthly.reduce((s, m) => s + m.income, 0) / monthly.length : 0;
  const avgExpense = monthly.length ? monthly.reduce((s, m) => s + m.expense, 0) / monthly.length : 0;
  const avgSavings = monthly.length ? monthly.reduce((s, m) => s + m.savings, 0) / monthly.length : 0;

  const fixedLikePattern = /\b(rent|mortgage|loan|insurance|tuition|debt|emi|utilities)\b/i;
  const rankedCategories = rawTopCategories
    .map((c) => ({
      ...c,
      monthlyAvg: c.amount / monthsAnalyzed,
      flexibilityScore: fixedLikePattern.test(c.category) ? 0.7 : 1.0,
      estimatedReduciblePct: fixedLikePattern.test(c.category) ? 0.08 : 0.2,
    }))
    .sort((a, b) => b.monthlyAvg * b.flexibilityScore - a.monthlyAvg * a.flexibilityScore);
  const top = rankedCategories.slice(0, 4);

  let goalName: string | null = null;
  let requiredMonthlyToHitDeadline: number | null = null;
  let predictedMonthlySavings: number | null = null;
  let monthlyShortfallToGoal = 0;

  if (selectedGoalId) {
    const goals = await fetchGoals(userId);
    const totalSavings = await fetchUserNetSavings(userId);
    const allocatedGoals = allocateGoalsByDeadline(goals, totalSavings);
    const goal = allocatedGoals.find((g) => g.id === selectedGoalId) ?? null;
    if (goal) {
      goalName = goal.name;
      const projection = await buildGoalProjection(userId, goal);
      requiredMonthlyToHitDeadline = projection.contract.requiredMonthlyToHitDeadline ?? null;
      predictedMonthlySavings = projection.predictedMonthlySavings ?? null;
      if (requiredMonthlyToHitDeadline != null && predictedMonthlySavings != null) {
        monthlyShortfallToGoal = Math.max(0, requiredMonthlyToHitDeadline - predictedMonthlySavings);
      }
    }
  }

  const scenarios = [0.05, 0.1, 0.2].map((pct) => {
    const impacted = top.reduce((sum, c) => sum + c.monthlyAvg * pct * c.flexibilityScore, 0);
    return {
      pct,
      monthlyImpact: impacted,
      sixMonthImpact: impacted * 6,
      projectedSavings6m: avgSavings * 6 + impacted * 6,
      closesGap: monthlyShortfallToGoal > 0 ? impacted >= monthlyShortfallToGoal : true,
    };
  });

  const best = scenarios[2];
  const topCategory = top[0];
  const neededPctForTop = topCategory
    ? Math.max(0, Math.min(100, (monthlyShortfallToGoal / Math.max(1, topCategory.monthlyAvg)) * 100))
    : null;
  const summary = goalName && monthlyShortfallToGoal > 0
    ? `For goal "${goalName}", you need about $${monthlyShortfallToGoal.toFixed(2)}/month more savings to stay on deadline. Prioritize reducing ${top.map((c) => c.category).join(", ")}.`
    : top.length
      ? `A practical way to increase savings is reducing ${top.map((c) => c.category).join(", ")} spending incrementally. A 10% reduction across these categories is estimated to add about $${scenarios[1].monthlyImpact.toFixed(2)} per month.`
      : "To increase savings, reduce variable categories first and move the reduced amount to a scheduled savings transfer.";

  return {
    intent: "prescriptive",
    subIntent: "savings_improvement",
    confidence: monthly.length >= 6 ? "high" : monthly.length >= 3 ? "medium" : "low",
    answerSummary: summary,
    sections: [
      { title: "Direct Answer", points: [summary] },
      {
        title: "Highest-Impact Categories",
        points: top.length
          ? top.map((c, idx) => `${idx + 1}. ${c.category}: $${c.amount.toFixed(2)} in selected range (~$${c.monthlyAvg.toFixed(2)}/month)`)
          : ["No category breakdown available in this range."],
      },
      ...(goalName
        ? [
            {
              title: "Goal Deadline Gap",
              points: [
                `Goal: ${goalName}`,
                `Required monthly savings to hit deadline: $${(requiredMonthlyToHitDeadline ?? 0).toFixed(2)}`,
                `Current predicted monthly savings: $${(predictedMonthlySavings ?? avgSavings).toFixed(2)}`,
                `Monthly shortfall to close: $${monthlyShortfallToGoal.toFixed(2)}`,
              ],
            },
          ]
        : []),
      {
        title: "Sensitivity Simulation",
        points: scenarios.map(
          (s) => `${Math.round(s.pct * 100)}% reduction => +$${s.monthlyImpact.toFixed(2)}/month, +$${s.sixMonthImpact.toFixed(2)} in 6 months (projected 6-month savings: $${s.projectedSavings6m.toFixed(2)})${goalName ? s.closesGap ? " [closes goal gap]" : " [does not fully close goal gap]" : ""}.`,
        ),
      },
      {
        title: "Recommended Plan",
        points: [
          ...(goalName && neededPctForTop != null
            ? [`To close the full gap using ${topCategory?.category ?? "top category"} alone, target about ${neededPctForTop.toFixed(1)}% reduction there (or split across top categories).`]
            : []),
          `Start with a ${Math.round(best.pct * 100)}% reduction in top variable categories.`,
          "Set an automatic transfer equal to expected monthly impact on income day.",
          "Review progress after 4 weeks and adjust percentage up/down.",
        ],
      },
    ],
    evidence: [
      { label: "Months analyzed", value: String(monthly.length) },
      { label: "Top categories used", value: top.map((c) => c.category).join(", ") || "None" },
      { label: "Average monthly income", value: `$${avgIncome.toFixed(2)}` },
      { label: "Average monthly expense", value: `$${avgExpense.toFixed(2)}` },
      { label: "Average monthly savings", value: `$${avgSavings.toFixed(2)}` },
      ...(goalName
        ? [
            { label: "Selected goal", value: goalName },
            { label: "Monthly shortfall to goal", value: `$${monthlyShortfallToGoal.toFixed(2)}` },
          ]
        : []),
      { label: "Question", value: question },
    ],
    suggestions: [
      "What if I cut these categories by only 5%?",
      "Show a 3-month savings impact for this plan.",
      "Which month had my largest overspending spike?",
      "What will my savings look like in 6 months if I follow this?",
    ],
  };
};

const buildDescriptiveResponse = (question: string, txns: TxnRecord[], subIntent: string): AssistantResponse => {
  const monthly = monthlyTotals(txns);
  const categories = topCategories(txns);

  const expenseMonthly = monthly.map((m) => ({ ...m, value: m.expense }));
  const most = expenseMonthly.length ? [...expenseMonthly].sort((a, b) => b.value - a.value)[0] : null;
  const least = expenseMonthly.length ? [...expenseMonthly].sort((a, b) => a.value - b.value)[0] : null;

  const totalIncome = monthly.reduce((s, m) => s + m.income, 0);
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0);
  const totalSavings = totalIncome - totalExpense;
  const expenseTxns = txns.filter((t) => t.type === "expense");
  const categoryMap = new Map<string, number>();
  expenseTxns.forEach((t) => {
    const key = (t.category || "Uncategorized").trim();
    categoryMap.set(key, (categoryMap.get(key) ?? 0) + toAmount(t.amount));
  });
  const categoryNames = Array.from(categoryMap.keys());

  const categoryQueryRaw =
    question.match(/\b(?:spend|spent|spending|expense|expenses)\s+on\s+([a-z0-9&/ -]+?)(?:\s+in\s+this\s+range|\?|$)/i)?.[1]?.trim() ??
    question.match(/\bon\s+([a-z0-9&/ -]+?)(?:\s+in\s+this\s+range|\?|$)/i)?.[1]?.trim() ??
    "";
  const categoryQuery = categoryQueryRaw.toLowerCase();
  const matchedCategory =
    categoryNames.find((c) => c.toLowerCase() === categoryQuery) ??
    categoryNames.find((c) => c.toLowerCase().includes(categoryQuery) || categoryQuery.includes(c.toLowerCase())) ??
    null;
  const matchedCategoryAmount = matchedCategory ? categoryMap.get(matchedCategory) ?? 0 : 0;

  let unusualMonthText: string | null = null;
  if (monthly.length >= 3) {
    const vals = monthly.map((m) => m.expense);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      const withZ = monthly.map((m) => ({ ...m, z: (m.expense - mean) / std }));
      const mostUnusual = [...withZ].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
      if (mostUnusual && Math.abs(mostUnusual.z) >= 1) {
        const direction = mostUnusual.z > 0 ? "higher" : "lower";
        unusualMonthText = `${mostUnusual.month} was unusual: spending was ${Math.abs(mostUnusual.z).toFixed(2)} standard deviations ${direction} than average.`;
      } else {
        unusualMonthText = "No strongly unusual month detected in this range.";
      }
    }
  }

  let summary = "I analyzed your selected date range and summarized your spending behavior.";
  if (subIntent === "max_spend_month" && most) summary = `Your highest spending month was ${most.month}.`;
  if (subIntent === "min_spend_month" && least) summary = `Your lowest spending month was ${least.month}.`;
  if (subIntent === "category_spend" && matchedCategory) {
    summary = `You spent $${matchedCategoryAmount.toFixed(2)} on ${matchedCategory} in this range.`;
  }
  if (subIntent === "category_spend" && !matchedCategory) {
    summary = "I could not confidently match that category in this range. Please name a category exactly as shown in your data.";
  }
  if (subIntent === "unusual_month" && unusualMonthText) {
    summary = unusualMonthText;
  }
  if (subIntent === "top_categories" && categories.length) {
    summary = `Your top expense category was ${categories[0].category}.`;
  }

  const points = [
    most ? `Highest expense month: ${most.month} ($${most.value.toFixed(2)})` : "No monthly expense data found.",
    least ? `Lowest expense month: ${least.month} ($${least.value.toFixed(2)})` : "No monthly expense data found.",
    categories.length
      ? `Top categories: ${categories.slice(0, 3).map((c) => `${c.category} ($${c.amount.toFixed(2)})`).join(", ")}`
      : "No category signal available.",
  ];

  const vol = monthly.length > 1
    ? (() => {
        const arr = monthly.map((m) => m.expense);
        const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
        const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
        return Math.sqrt(variance);
      })()
    : 0;

  const confidenceProb = monthly.length >= 6 ? 0.82 : monthly.length >= 3 ? 0.66 : 0.48;

  return {
    intent: "descriptive",
    subIntent,
    confidence: toConfidenceLabel(confidenceProb),
    answerSummary: summary,
    sections: [
      { title: "Direct Answer", points: [summary] },
      { title: "Evidence", points },
      {
        title: "Range Overview",
        points: [
          `Total income: $${totalIncome.toFixed(2)}`,
          `Total expense: $${totalExpense.toFixed(2)}`,
          `Net savings: $${totalSavings.toFixed(2)}`,
          `Expense volatility (std): $${vol.toFixed(2)}`,
        ],
      },
    ],
    evidence: [
      { label: "Months analyzed", value: String(monthly.length) },
      { label: "Transactions analyzed", value: String(txns.length) },
      { label: "Question", value: question },
    ],
    suggestions: buildDescriptiveSuggestions({ monthly, categories, subIntent }),
  };
};

const buildPredictiveResponse = async (
  userId: string,
  question: string,
  txns: TxnRecord[],
  selectedGoalId: string | null,
  subIntent: string,
): Promise<AssistantResponse> => {
  const monthly = monthlyTotals(txns);
  const categories = topCategories(txns);
  const horizon = parseHorizonMonths(question);
  const scenario = parseScenarioAdjustment(question);

  const avgIncome = monthly.length
    ? monthly.reduce((s, m) => s + m.income, 0) / monthly.length
    : 0;
  const avgExpense = monthly.length
    ? monthly.reduce((s, m) => s + m.expense, 0) / monthly.length
    : 0;
  const avgSavings = monthly.length
    ? monthly.reduce((s, m) => s + m.savings, 0) / monthly.length
    : 0;

  // Route predictive output by requested metric.
  let forecastMetric: "savings" | "income" | "expense" = "savings";
  if (subIntent === "income_forecast") forecastMetric = "income";
  if (subIntent === "expense_forecast") forecastMetric = "expense";
  let adjustedAvgSavings = avgSavings;
  if (scenario.detected) {
    const factor = scenario.pct / 100;
    if (scenario.metric === "savings") {
      adjustedAvgSavings =
        scenario.direction === "increase"
          ? avgSavings * (1 + factor)
          : avgSavings * (1 - factor);
    } else if (scenario.metric === "income") {
      const adjustedIncome =
        scenario.direction === "increase"
          ? avgIncome * (1 + factor)
          : avgIncome * (1 - factor);
      adjustedAvgSavings = adjustedIncome - avgExpense;
    } else {
      const adjustedExpense =
        scenario.direction === "increase"
          ? avgExpense * (1 + factor)
          : avgExpense * (1 - factor);
      adjustedAvgSavings = avgIncome - adjustedExpense;
    }
  }

  const projectedCumulative = adjustedAvgSavings * horizon;
  const baselineProjected = avgSavings * horizon;

  const projectedIncome = avgIncome * horizon;
  const projectedExpense = avgExpense * horizon;

  const sections: AssistantSection[] = [];
  const evidence: Array<{ label: string; value: string }> = [
    { label: "Months analyzed", value: String(monthly.length) },
    { label: "Forecast horizon (months)", value: String(horizon) },
  ];

  let summary = `If current trend continues, projected cumulative savings in ${horizon} months is $${projectedCumulative.toFixed(2)}.`;
  if (forecastMetric === "income") {
    summary = `If current trend continues, projected cumulative income in ${horizon} months is $${projectedIncome.toFixed(2)}.`;
  }
  if (forecastMetric === "expense") {
    summary = `If current trend continues, projected cumulative expenses in ${horizon} months is $${projectedExpense.toFixed(2)}.`;
  }
  let outputSubIntent = subIntent;
  if (scenario.detected) {
    outputSubIntent = "sensitivity_scenario";
    summary = `Under this scenario (${scenario.direction} ${scenario.metric} by ${scenario.pct}%), projected cumulative savings in ${horizon} months is $${projectedCumulative.toFixed(2)} (baseline $${baselineProjected.toFixed(2)}).`;
    evidence.push(
      { label: "Scenario", value: `${scenario.direction} ${scenario.metric} by ${scenario.pct}%` },
      { label: "Baseline projection", value: `$${baselineProjected.toFixed(2)}` },
    );
  }

  let selectedGoalName: string | null = null;
  if (selectedGoalId) {
    const goals = await fetchGoals(userId);
    const totalSavings = await fetchUserNetSavings(userId);
    const allocatedGoals = allocateGoalsByDeadline(goals, totalSavings);
    const goal = allocatedGoals.find((g) => g.id === selectedGoalId) ?? null;
    if (goal) {
      selectedGoalName = goal.name;
      const isAchieved = (Number(goal.currentAmount) || 0) >= (Number(goal.targetAmount) || 0);
      const projection = await buildGoalProjection(userId, goal);
      if (isAchieved) {
        summary = `Goal \"${goal.name}\" is achieved.`;
        evidence.push(
          { label: "Goal", value: goal.name },
          { label: "Goal target", value: `$${goal.targetAmount.toFixed(2)}` },
          { label: "Allocated savings", value: `$${goal.currentAmount.toFixed(2)}` },
          { label: "Status", value: "Achieved" },
        );
        sections.push({
          title: "Goal Status",
          points: [
            "This goal is already completed in the current allocation.",
            "No additional completion prediction is required.",
          ],
        });
      } else {
        const prob = projection.contract.probabilityAchievableByDeadline ?? 0;
        const statusText =
          projection.contract.achievableByDeadline === true
            ? "on track by deadline"
            : projection.contract.achievableByDeadline === false
              ? "not projected by deadline"
              : "insufficient data for deadline decision";

        summary = `For goal \"${goal.name}\", you are ${statusText} with probability ${(prob * 100).toFixed(1)}%.`;
        evidence.push(
          { label: "Goal", value: goal.name },
          { label: "Goal target", value: `$${goal.targetAmount.toFixed(2)}` },
          { label: "Probability achievable", value: `${(prob * 100).toFixed(1)}%` },
        );

        sections.push({
          title: "Goal Forecast",
          points: [
            `Status: ${statusText}`,
            `Predicted completion date: ${projection.contract.predictedCompletionDate ?? "N/A"}`,
            `Required monthly to hit deadline: $${(projection.contract.requiredMonthlyToHitDeadline ?? 0).toFixed(2)}`,
            `Predicted monthly savings: $${(projection.predictedMonthlySavings ?? 0).toFixed(2)}`,
          ],
        });
      }
    }
  }

  if (!sections.length) {
    if (forecastMetric === "income") {
      sections.push({
        title: "Income Forecast",
        points: [
          `Average monthly income in selected range: $${avgIncome.toFixed(2)}`,
          `Projected cumulative income in ${horizon} months: $${projectedIncome.toFixed(2)}`,
          `Assumed monthly income trend: $${avgIncome.toFixed(2)}`,
        ],
      });
    } else if (forecastMetric === "expense") {
      sections.push({
        title: "Expense Forecast",
        points: [
          `Average monthly expenses in selected range: $${avgExpense.toFixed(2)}`,
          `Projected cumulative expenses in ${horizon} months: $${projectedExpense.toFixed(2)}`,
          `Assumed monthly expense trend: $${avgExpense.toFixed(2)}`,
        ],
      });
    } else {
      sections.push({
        title: "Savings Forecast",
        points: [
          `Average monthly savings in selected range: $${avgSavings.toFixed(2)}`,
          scenario.detected
            ? `Scenario-adjusted monthly savings: $${adjustedAvgSavings.toFixed(2)}`
            : `Projected monthly savings (unchanged scenario): $${adjustedAvgSavings.toFixed(2)}`,
          `Projected cumulative savings in ${horizon} months: $${projectedCumulative.toFixed(2)}`,
          scenario.detected
            ? `Delta vs baseline: $${(projectedCumulative - baselineProjected).toFixed(2)}`
            : `Baseline projection: $${baselineProjected.toFixed(2)}`,
        ],
      });
    }
  }

  const confidenceProb = monthly.length >= 6 ? 0.79 : monthly.length >= 3 ? 0.61 : 0.42;

  return {
    intent: "predictive",
    subIntent: outputSubIntent,
    confidence: toConfidenceLabel(confidenceProb),
    answerSummary: summary,
    sections: [
      { title: "Direct Answer", points: [summary] },
      ...sections,
      {
        title: "Assumptions",
        points: [
          "Forecast assumes recent trend continues.",
          "Date-range selection directly affects forecast quality.",
        ],
      },
    ],
    evidence,
    suggestions: buildPredictiveSuggestions({
      monthly,
      categories,
      selectedGoalName,
      horizon,
      forecastMetric,
      scenarioDetected: scenario.detected,
    }),
  };
};

export const answerAssistantQuestion = async (params: {
  userId: string;
  question: string;
  startDate: string;
  endDate: string;
  selectedGoalId?: string | null;
  chatHistory?: ChatContextMessage[];
}) => {
  const { userId, question, startDate, endDate, selectedGoalId, chatHistory = [] } = params;
  const trimmedQuestion = question.trim();
  const planner = await planPromptWithLlm({
    question: trimmedQuestion,
    chatHistory,
    selectedGoalId: selectedGoalId ?? null,
    startDate,
    endDate,
  });

  if (planner?.needsClarification && planner.clarificationQuestion) {
    return {
      intent: planner.intent,
      subIntent: planner.subIntent || "clarification_needed",
      confidence: "medium",
      answerSummary: planner.clarificationQuestion,
      sections: [
        { title: "Need Clarification", points: [planner.clarificationQuestion] },
      ],
      evidence: [
        { label: "Planner", value: "llm" },
      ],
      suggestions: [
        "Use my selected goal and answer this.",
        "Use savings forecast for the next 6 months.",
      ],
    } satisfies AssistantResponse;
  }

  const priorScenario = findLastScenarioContext(chatHistory);
  const maybeContextualized =
    shouldContextualizeQuestion(trimmedQuestion) && chatHistory.length
      ? await contextualizeQuestionWithLlm(trimmedQuestion, chatHistory)
      : null;

  let effectiveQuestion = maybeContextualized ?? trimmedQuestion;
  if (planner) {
    const planHorizon = planner.horizonMonths ?? parseHorizonMonths(effectiveQuestion);
    const planMetric = planner.metric ?? inferForecastMetric(effectiveQuestion);
    const lockDescriptive = hasStrongDescriptiveSignal(trimmedQuestion);
    if (planner.intent === "predictive" && !lockDescriptive) {
      effectiveQuestion = `What will my ${planMetric} look like in ${planHorizon} months?`;
      if (planner.scenario) {
        effectiveQuestion = `What if my ${planner.scenario.metric} ${planner.scenario.direction}s by ${planner.scenario.pct}% in ${planHorizon} months?`;
      }
    }
    if (planner.intent === "prescriptive" && planner.subIntent === "savings_improvement") {
      effectiveQuestion = `How can I increase my savings${planner.useSelectedGoal && selectedGoalId ? " to hit my selected goal deadline" : ""}?`;
    }
  }

  if (isBaselineWithoutScenarioQuestion(trimmedQuestion) && priorScenario) {
    effectiveQuestion = `What will my ${priorScenario.metric} look like in ${priorScenario.horizonMonths} months?`;
  } else {
    const parsedScenario = parseScenarioAdjustment(effectiveQuestion);
    if (parsedScenario.detected && !/\b(savings|income|expense|spending|cost)\b/i.test(effectiveQuestion) && priorScenario) {
      effectiveQuestion = `${effectiveQuestion} for ${priorScenario.metric}`;
    }
    if (parsedScenario.detected && !/\b\d+\s*month/i.test(effectiveQuestion) && priorScenario) {
      effectiveQuestion = `${effectiveQuestion} in ${priorScenario.horizonMonths} months`;
    }
  }

  const lexicalIntent = detectIntent(effectiveQuestion);
  const intent = planner && lexicalIntent.confidenceHint < 0.85
    ? {
        intent: planner.intent,
        subIntent: planner.subIntent || "general_descriptive",
        confidenceHint: 0.9,
      }
    : lexicalIntent;
  const txns = await fetchTransactionsInRange(userId, startDate, endDate);

  if (!txns.length) {
    const baseNoData = {
      intent: intent.intent,
      subIntent: intent.subIntent,
      confidence: "low" as ConfidenceLabel,
      answerSummary: "No transactions found in the selected date range.",
      sections: [
        {
          title: "Data Availability",
          points: [
            "No transactions are available in the selected range.",
            "Try expanding your date range or import transactions first.",
          ],
        },
      ],
      evidence: [
        { label: "Transactions analyzed", value: "0" },
      ],
      suggestions: [
        "Expand date range and retry.",
        "Add or import transactions.",
      ],
    } satisfies AssistantResponse;
    const narrated = await narrateWithLlm(baseNoData, effectiveQuestion);
    const refined = await refineSuggestionsWithLlm(effectiveQuestion, baseNoData.suggestions);
    if (!narrated) {
      return applySimpleDirectAnswer({
        ...baseNoData,
        suggestions: (refined ?? baseNoData.suggestions).slice(0, 5),
      });
    }
    return applySimpleDirectAnswer({
      ...baseNoData,
      answerSummary: narrated.answerSummary,
      sections: narrated.sections,
      suggestions: (refined ?? narrated.suggestions ?? baseNoData.suggestions).slice(0, 5),
    });
  }

  const monthly = monthlyTotals(txns);
  const baseResponse =
    intent.intent === "prescriptive"
      ? await buildPrescriptiveSavingsResponse(userId, effectiveQuestion, txns, selectedGoalId ?? null)
      : isGeneralFinanceGuidanceQuestion(effectiveQuestion) && intent.subIntent === "general_descriptive"
        ? await buildGuidanceResponse(effectiveQuestion, monthly)
        : intent.intent === "predictive"
        ? await buildPredictiveResponse(
            userId,
            effectiveQuestion,
            txns,
            selectedGoalId ?? null,
            intent.subIntent,
          )
        : buildDescriptiveResponse(effectiveQuestion, txns, intent.subIntent);

  // Blend rule/keyword intent confidence with data-backed response confidence.
  const txCountBoost = txns.length >= 25 ? 0.06 : txns.length >= 10 ? 0.03 : 0;
  const blendedConfidence = Math.max(
    confidenceScore(baseResponse.confidence),
    Math.min(1, intent.confidenceHint + txCountBoost),
  );
  const responseWithConfidence: AssistantResponse = {
    ...baseResponse,
    confidence: toConfidenceLabel(blendedConfidence),
    sections: [
      ...baseResponse.sections,
      ...(baseResponse.intent === "predictive" && monthly.length < 3
        ? [
            {
              title: "Data Quality Warning",
              points: [
                `Only ${monthly.length} month(s) found in selected range; forecast uncertainty is high.`,
                "Use at least 3-6 months of data for more stable projections.",
              ],
            },
          ]
        : []),
      {
        title: "Important Note",
        points: [
          "This is analytical guidance, not financial advice.",
          "Forecast quality depends on date-range coverage and transaction quality.",
        ],
      },
    ],
  };

  // Safety rail: if intent is still too generic + low confidence, ask clarification
  // instead of returning a potentially irrelevant answer.
  if (
    responseWithConfidence.confidence === "low" &&
    (responseWithConfidence.subIntent === "general_descriptive" ||
      responseWithConfidence.subIntent === "general_predictive")
  ) {
    return applySimpleDirectAnswer({
      ...responseWithConfidence,
      answerSummary:
        "I can answer this, but I need a bit more specificity to avoid a wrong result.",
      sections: [
        {
          title: "Need Clarification",
          points: [
            "Tell me the metric (income, expense, savings, or category).",
            "Tell me if you want descriptive (past), predictive (future), or prescriptive (what to do).",
          ],
        },
      ],
      suggestions: [
        "How much did I spend on Groceries in this range?",
        "Which month had my highest spending in this range?",
        "What will my savings look like in 6 months?",
        "How can I increase my savings to hit my goal?",
      ],
    });
  }

  const narrated = await narrateWithLlm(responseWithConfidence, effectiveQuestion);
  const suggestionCandidates = dedupeSuggestions([
    ...responseWithConfidence.suggestions,
    ...(narrated?.suggestions ?? []),
  ]).slice(0, 8);
  const refinedSuggestions = await refineSuggestionsWithLlm(effectiveQuestion, suggestionCandidates);
  if (!narrated) {
    return applySimpleDirectAnswer({
      ...responseWithConfidence,
      suggestions: (refinedSuggestions ?? responseWithConfidence.suggestions).slice(0, 5),
    });
  }
  return applySimpleDirectAnswer({
    ...responseWithConfidence,
    answerSummary: narrated.answerSummary,
    sections: narrated.sections,
    suggestions: (refinedSuggestions ?? suggestionCandidates).slice(0, 5),
  });
};

export const buildQuickIntents = async (params: {
  userId: string;
  startDate: string;
  endDate: string;
}) => {
  const { userId, startDate, endDate } = params;
  const txns = await fetchTransactionsInRange(userId, startDate, endDate);
  const monthly = monthlyTotals(txns);
  const categories = topCategories(txns);
  const goals = await fetchGoals(userId);

  const highMonth = monthly.length ? [...monthly].sort((a, b) => b.expense - a.expense)[0] : null;
  const urgentGoal = [...goals].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())[0] ?? null;

  const suggestions = [
    "Which month did I spend the most?",
    "What are my top expense categories?",
    "What will my savings look like in 6 months?",
  ];

  if (highMonth) {
    suggestions.unshift(`Why was my spending high in ${highMonth.month}?`);
  }
  if (categories.length) {
    suggestions.unshift(`How much do I spend on ${categories[0].category}?`);
  }
  if (urgentGoal) {
    suggestions.unshift(`Will I hit ${urgentGoal.name} by ${new Date(urgentGoal.deadline).toLocaleDateString()}?`);
  }

  return suggestions.slice(0, 6);
};

const quickIntentCache = new Map<string, { expiresAt: number; intents: string[] }>();
const QUICK_INTENT_TTL_MS = 60 * 1000;

export const buildQuickIntentsCached = async (params: {
  userId: string;
  startDate: string;
  endDate: string;
}) => {
  const key = `${params.userId}:${params.startDate}:${params.endDate}`;
  const now = Date.now();
  const hit = quickIntentCache.get(key);
  if (hit && hit.expiresAt > now) return hit.intents;
  const intents = await buildQuickIntents(params);
  quickIntentCache.set(key, { intents, expiresAt: now + QUICK_INTENT_TTL_MS });
  return intents;
};

export const getAssistantHealth = () => ({
  status: "ok" as const,
  llmEnabled: Boolean(openaiClient),
  plannerEnabled: Boolean(openaiClient),
  privacyMode: "redacted-minimum-context",
  model: openaiClient ? "gpt-5-mini" : null,
  cache: {
    quickIntentKeys: quickIntentCache.size,
    quickIntentTtlMs: QUICK_INTENT_TTL_MS,
  },
  limits: {
    threadLimit,
    messageLimit,
  },
});

export const createAssistantThread = async (userId: string, title: string) => {
  const nowIso = new Date().toISOString();
  const ref = firestore.collection("users").doc(userId).collection("assistant_chats").doc();
  await ref.set({
    id: ref.id,
    title,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastMessagePreview: "",
  });
  return ref.id;
};

export const listAssistantThreads = async (userId: string) => {
  const snap = await firestore
    .collection("users")
    .doc(userId)
    .collection("assistant_chats")
    .orderBy("updatedAt", "desc")
    .limit(threadLimit)
    .get();
  return snap.docs.map((d) => d.data());
};

export const getAssistantThreadMessages = async (
  userId: string,
  chatId: string,
  limit = messageLimit,
) => {
  const safeLimit = Math.max(1, Math.min(messageLimit, limit));
  const snap = await firestore
    .collection("users")
    .doc(userId)
    .collection("assistant_chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(safeLimit)
    .get();
  return snap.docs.map((d) => d.data()).reverse();
};

export const appendAssistantMessage = async (params: {
  userId: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  payload?: Record<string, unknown>;
}) => {
  const { userId, chatId, role, text, payload } = params;
  const nowIso = new Date().toISOString();
  const threadRef = firestore.collection("users").doc(userId).collection("assistant_chats").doc(chatId);
  const msgRef = threadRef.collection("messages").doc();

  await msgRef.set({
    id: msgRef.id,
    role,
    text,
    payload: payload ?? null,
    createdAt: nowIso,
  });

  const threadSnap = await threadRef.get();
  const currentTitle = (threadSnap.data()?.title as string | undefined) ?? "";
  const shouldSetTitleFromFirstPrompt =
    role === "user" &&
    (!currentTitle.trim() || currentTitle.trim().toLowerCase() === "new chat");

  await threadRef.set(
    {
      updatedAt: nowIso,
      lastMessagePreview: text.slice(0, 220),
      ...(shouldSetTitleFromFirstPrompt ? { title: text.slice(0, 80) } : {}),
    },
    { merge: true },
  );
};

export const hardDeleteAssistantThread = async (userId: string, chatId: string) => {
  const threadRef = firestore.collection("users").doc(userId).collection("assistant_chats").doc(chatId);
  const messages = await threadRef.collection("messages").get();
  const batch = firestore.batch();
  messages.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(threadRef);
  await batch.commit();
};

export const renameAssistantThread = async (userId: string, chatId: string, title: string) => {
  const safeTitle = title.trim().slice(0, 80) || "New Chat";
  await firestore
    .collection("users")
    .doc(userId)
    .collection("assistant_chats")
    .doc(chatId)
    .set(
      {
        title: safeTitle,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
};

export const exportAssistantThread = async (userId: string, chatId: string) => {
  const threadRef = firestore.collection("users").doc(userId).collection("assistant_chats").doc(chatId);
  const [threadSnap, messages] = await Promise.all([
    threadRef.get(),
    getAssistantThreadMessages(userId, chatId, messageLimit),
  ]);
  if (!threadSnap.exists) {
    throw new Error("Chat not found.");
  }
  return {
    thread: threadSnap.data(),
    messages,
    exportedAt: new Date().toISOString(),
  };
};
