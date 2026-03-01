import { firestore } from "../firebaseAdmin";
import { buildGoalProjection, fetchGoals, fetchUserNetSavings, type GoalDoc } from "./goalProjection";
import OpenAI from "openai";

export type AssistantIntent = "descriptive" | "predictive";
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

export type TxnRecord = {
  date: string;
  category: string;
  amount: number | string;
  type: "income" | "expense";
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

const detectIntent = (question: string): { intent: AssistantIntent; subIntent: string; confidenceHint: number } => {
  const q = question.toLowerCase();
  const tokens = tokenize(q);

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

const narrateWithLlm = async (
  base: AssistantResponse,
  question: string,
): Promise<AssistantNarration | null> => {
  if (!openaiClient) return null;
  try {
    const response = await openaiClient.responses.create({
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
            question,
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

const allocateGoalsByDeadline = (goals: GoalDoc[], totalSavings: number): GoalDoc[] => {
  let pool = Math.max(0, totalSavings);
  const sorted = [...goals].sort((a, b) => {
    const aTime = new Date(a.deadline).getTime();
    const bTime = new Date(b.deadline).getTime();
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid) return aTime - bTime;
    if (aValid) return -1;
    if (bValid) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return sorted.map((goal) => {
    const target = Math.max(0, Number(goal.targetAmount) || 0);
    const hasOverride = goal.allocationOverride != null;
    const overrideRaw = hasOverride ? Number(goal.allocationOverride) : 0;
    const validOverride = hasOverride && Number.isFinite(overrideRaw) && overrideRaw >= 0;
    const requested = validOverride ? Math.min(target, overrideRaw) : target;
    const allocated = Math.min(requested, pool);
    pool = Math.max(0, pool - allocated);
    return { ...goal, currentAmount: allocated };
  });
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

  let summary = "I analyzed your selected date range and summarized your spending behavior.";
  if (subIntent === "max_spend_month" && most) summary = `Your highest spending month was ${most.month}.`;
  if (subIntent === "min_spend_month" && least) summary = `Your lowest spending month was ${least.month}.`;
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
    suggestions: [
      "Which month was unusual and why?",
      "Show top categories and their trend over this range.",
      "Forecast my savings for the next 6 months.",
    ],
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

  if (selectedGoalId) {
    const goals = await fetchGoals(userId);
    const totalSavings = await fetchUserNetSavings(userId);
    const allocatedGoals = allocateGoalsByDeadline(goals, totalSavings);
    const goal = allocatedGoals.find((g) => g.id === selectedGoalId) ?? null;
    if (goal) {
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
    suggestions: [
      "Will I hit my selected goal by its deadline?",
      "What if my monthly savings increases by 10%?",
      "Show my highest spending month in this range.",
    ],
  };
};

export const answerAssistantQuestion = async (params: {
  userId: string;
  question: string;
  startDate: string;
  endDate: string;
  selectedGoalId?: string | null;
}) => {
  const { userId, question, startDate, endDate, selectedGoalId } = params;
  const intent = detectIntent(question);
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
    const narrated = await narrateWithLlm(baseNoData, question);
    if (!narrated) return baseNoData;
    return {
      ...baseNoData,
      answerSummary: narrated.answerSummary,
      sections: narrated.sections,
      suggestions: narrated.suggestions.slice(0, 5),
    };
  }

  const baseResponse =
    intent.intent === "predictive"
      ? await buildPredictiveResponse(userId, question, txns, selectedGoalId ?? null, intent.subIntent)
      : buildDescriptiveResponse(question, txns, intent.subIntent);

  const narrated = await narrateWithLlm(baseResponse, question);
  if (!narrated) {
    return baseResponse;
  }
  return {
    ...baseResponse,
    answerSummary: narrated.answerSummary,
    sections: narrated.sections,
    suggestions: narrated.suggestions.slice(0, 5),
  };
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
    .get();
  return snap.docs.map((d) => d.data());
};

export const getAssistantThreadMessages = async (userId: string, chatId: string) => {
  const snap = await firestore
    .collection("users")
    .doc(userId)
    .collection("assistant_chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map((d) => d.data());
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
