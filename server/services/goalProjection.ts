import path from "path";
import { firestore } from "../firebaseAdmin";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREDICT_SCRIPT = path.join(__dirname, "..", "ml", "predict_goal_projection.py");

export type GoalDoc = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  allocationOverride?: number | null;
  deadline: string; // ISO date
  category?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoalProjection = {
  // Legacy fields kept for compatibility with existing UI consumers.
  predictedMonthlySavings: number | null;
  lowMonthlySavings: number | null;
  highMonthlySavings: number | null;
  projectedMonths: number | null;
  optimisticMonths: number | null;
  pessimisticMonths: number | null;
  projectedCompletionDate: string | null;
  optimisticCompletionDate: string | null;
  pessimisticCompletionDate: string | null;
  status: "on_track" | "behind" | "at_risk" | "insufficient_data";
  reasoning: string[];
  // Final production contract (frozen config + explainability).
  contract: {
    modelConfig: {
      regressionModel: string;
      classificationModel: string;
      thresholdPolicy: string;
      threshold: number;
      trainedRows: number;
      notes: string;
    };
    achievableByDeadline: boolean | null;
    probabilityAchievableByDeadline: number | null;
    projectedNetCashflowByDeadline: number | null;
    projectedGoalBalanceAtDeadline: number | null;
    requiredMonthlyToHitDeadline: number | null;
    predictedCompletionDate: string | null;
    statusMessage: string;
    explainability: Array<{
      label: string;
      impact: "positive" | "negative" | "neutral";
      detail: string;
    }>;
  };
};

const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const addMonths = (date: Date, months: number) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1));
  const daysInTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTargetMonth));
  return target;
};

const clampPositive = (value: number) => (Number.isFinite(value) ? value : 0);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const computeMonthsToGoal = (remaining: number, monthly: number) => {
  if (!Number.isFinite(monthly) || monthly <= 0) return null;
  return Math.max(1, Math.ceil(remaining / monthly));
};

const computeMonthsUntil = (from: Date, to: Date) => {
  const fromMonth = from.getUTCFullYear() * 12 + from.getUTCMonth();
  const toMonth = to.getUTCFullYear() * 12 + to.getUTCMonth();
  return Math.max(1, toMonth - fromMonth);
};

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const FINAL_MODEL_CONFIG = Object.freeze({
  regressionModel: "LinearRegression",
  classificationModel: "RandomForestClassifier",
  thresholdPolicy: "balanced",
  threshold: 0.41,
  trainedRows: 20126,
  notes:
    "Production artifacts loaded from server/ml/models with deadline contract and explainability enabled.",
});

const buildFeaturesFromHistory = (history: MonthlySummary[]) => {
  if (history.length < 3) return null;
  const last3 = history.slice(-3);
  const avg = (values: number[]) => values.reduce((sum, val) => sum + val, 0) / values.length;
  const meanSavings = avg(last3.map((m) => m.savings));
  const variance = avg(last3.map((m) => (m.savings - meanSavings) ** 2));
  const stdSavings = Math.sqrt(variance);
  const trend = last3[last3.length - 1].savings - last3[0].savings;

  const avgIncome = avg(last3.map((m) => m.income));
  const avgExpense = avg(last3.map((m) => m.expense));
  const avgTxnCount = avg(last3.map((m) => m.txnCount));
  const incomeStd = Math.sqrt(avg(last3.map((m) => (m.income - avgIncome) ** 2)));
  const expenseStd = Math.sqrt(avg(last3.map((m) => (m.expense - avgExpense) ** 2)));
  const savingsStd = Math.sqrt(avg(last3.map((m) => (m.savings - meanSavings) ** 2)));
  const lag1Savings = last3[last3.length - 1].savings;
  const lag2Savings = last3[last3.length - 2].savings;
  const avgIncomeRatio = avg(last3.map((m) => (m.totalFlow > 0 ? m.income / m.totalFlow : 0)));
  const avgExpenseRatio = avg(last3.map((m) => (m.totalFlow > 0 ? m.expense / m.totalFlow : 0)));

  const nextMonth = new Date(Date.UTC(last3[last3.length - 1].year, last3[last3.length - 1].monthIndex + 1, 1));
  const monthNum = nextMonth.getUTCMonth() + 1;
  const monthSin = Math.sin((2 * Math.PI * monthNum) / 12);
  const monthCos = Math.cos((2 * Math.PI * monthNum) / 12);

  return {
    prev3_avg_savings: meanSavings,
    prev3_std_savings: stdSavings,
    prev3_trend: trend,
    prev3_avg_income: avgIncome,
    prev3_avg_expense: avgExpense,
    prev3_avg_txn_count: avgTxnCount,
    prev3_income_ratio: avgIncomeRatio,
    prev3_expense_ratio: avgExpenseRatio,
    prev3_income_std: incomeStd,
    prev3_expense_std: expenseStd,
    prev3_savings_std: savingsStd,
    lag1_savings: lag1Savings,
    lag2_savings: lag2Savings,
    month_num: monthNum,
    month_sin: monthSin,
    month_cos: monthCos,
  };
};

const runPrediction = async (features: Record<string, number>) => {
  const payload = JSON.stringify({ features });
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("python3", [PREDICT_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Goal prediction script failed (code ${code}): ${err}`));
        return;
      }
      resolve(out);
    });

    child.stdin.write(payload);
    child.stdin.end();
  });

  return JSON.parse(stdout) as {
    predicted_savings: number;
    low_savings: number;
    high_savings: number;
    residual_std: number;
    classification_probability?: number | null;
  };
};

export type MonthlySummary = {
  year: number;
  monthIndex: number;
  income: number;
  expense: number;
  savings: number;
  txnCount: number;
  totalFlow: number;
};

export const fetchMonthlySummaries = async (userId: string, monthsBack: number, now = new Date()) => {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack + 1, 1));

  const snapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("transactions")
    .where("date", ">=", start.toISOString())
    .where("date", "<", end.toISOString())
    .orderBy("date", "asc")
    .get();

  const monthlyMap = new Map<string, MonthlySummary>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const date = new Date(data.date);
    if (Number.isNaN(date.getTime())) return;
    const key = monthKey(date);
    const entry = monthlyMap.get(key) ?? {
      year: date.getUTCFullYear(),
      monthIndex: date.getUTCMonth(),
      income: 0,
      expense: 0,
      savings: 0,
      txnCount: 0,
      totalFlow: 0,
    };
    const amount = Number(data.amount) || 0;
    if (data.type === "income") {
      entry.income += amount;
    }
    if (data.type === "expense") {
      entry.expense += amount;
    }
    entry.txnCount += 1;
    entry.totalFlow = entry.income + entry.expense;
    entry.savings = entry.income - entry.expense;
    monthlyMap.set(key, entry);
  });

  return Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
};

export const fetchUserNetSavings = async (userId: string): Promise<number> => {
  const snapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("transactions")
    .get();

  let income = 0;
  let expense = 0;

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const amount = Number(data.amount) || 0;
    if (data.type === "income") income += amount;
    if (data.type === "expense") expense += amount;
  });

  return income - expense;
};

export type AllocatedGoal = GoalDoc & { savingsLeftAfterGoal: number };

export const allocateGoalsByDeadline = (goals: GoalDoc[], totalSavings: number): AllocatedGoal[] => {
  const availablePool = Math.max(0, totalSavings);
  let remainingPool = availablePool;

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
    const target = Number(goal.targetAmount) || 0;
    const hasOverride = goal.allocationOverride != null;
    const overrideRaw = hasOverride ? Number(goal.allocationOverride) : 0;
    const validOverride = hasOverride && Number.isFinite(overrideRaw) && overrideRaw >= 0;
    const requested = validOverride ? Math.min(target, overrideRaw) : target;
    const allocated = Math.min(Math.max(0, requested), Math.max(0, remainingPool));
    remainingPool -= allocated;

    return {
      ...goal,
      currentAmount: allocated,
      savingsLeftAfterGoal: Math.max(0, remainingPool),
    };
  });
};

export const buildGoalProjection = async (userId: string, goal: GoalDoc, now = new Date()): Promise<GoalProjection> => {
  const history = await fetchMonthlySummaries(userId, 6, now);
  const features = buildFeaturesFromHistory(history);

  if (!features) {
    return {
      predictedMonthlySavings: null,
      lowMonthlySavings: null,
      highMonthlySavings: null,
      projectedMonths: null,
      optimisticMonths: null,
      pessimisticMonths: null,
      projectedCompletionDate: null,
      optimisticCompletionDate: null,
      pessimisticCompletionDate: null,
      status: "insufficient_data",
      reasoning: ["Need at least 3 months of savings history to forecast."],
      contract: {
        modelConfig: FINAL_MODEL_CONFIG,
        achievableByDeadline: null,
        probabilityAchievableByDeadline: null,
        projectedNetCashflowByDeadline: null,
        projectedGoalBalanceAtDeadline: null,
        requiredMonthlyToHitDeadline: null,
        predictedCompletionDate: null,
        statusMessage: "Insufficient history to evaluate this goal.",
        explainability: [
          {
            label: "Insufficient data",
            impact: "neutral",
            detail: "Need at least 3 months of transactions to compute stable rolling features.",
          },
        ],
      },
    };
  }

  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const deadlineDate = goal.deadline ? new Date(goal.deadline) : null;
  const monthsToDeadline = deadlineDate ? computeMonthsUntil(now, deadlineDate) : null;
  const requiredMonthlyToHitDeadline =
    monthsToDeadline && monthsToDeadline > 0 ? remaining / monthsToDeadline : null;
  const targetSavingsRatio =
    requiredMonthlyToHitDeadline && requiredMonthlyToHitDeadline > 0
      ? features.prev3_avg_savings / requiredMonthlyToHitDeadline
      : 0;

  // Enrich model payload with goal/deadline-specific fields used by classification artifacts.
  const prediction = await runPrediction({
    ...features,
    remaining_amount: remaining,
    months_left: monthsToDeadline ?? 0,
    required_monthly: requiredMonthlyToHitDeadline ?? 0,
    target_savings_ratio: targetSavingsRatio,
  });

  const predicted = clampPositive(prediction.predicted_savings);
  const low = clampPositive(prediction.low_savings);
  const high = clampPositive(prediction.high_savings);

  const projectedMonths = computeMonthsToGoal(remaining, predicted);
  const optimisticMonths = computeMonthsToGoal(remaining, high);
  const pessimisticMonths = computeMonthsToGoal(remaining, low);

  const projectedCompletionDate = projectedMonths ? addMonths(now, projectedMonths).toISOString() : null;
  const optimisticCompletionDate = optimisticMonths ? addMonths(now, optimisticMonths).toISOString() : null;
  const pessimisticCompletionDate = pessimisticMonths ? addMonths(now, pessimisticMonths).toISOString() : null;

  let status: GoalProjection["status"] = "behind";
  const deadline = goal.deadline ? new Date(goal.deadline) : null;

  if (!deadline || !projectedCompletionDate) {
    status = predicted > 0 ? "on_track" : "behind";
  } else {
    const projectedDate = new Date(projectedCompletionDate);
    const optimisticDate = optimisticCompletionDate ? new Date(optimisticCompletionDate) : null;
    if (optimisticDate && optimisticDate > deadline) {
      status = "at_risk";
    } else if (projectedDate > deadline) {
      status = "behind";
    } else {
      status = "on_track";
    }
  }

  const reasoning = [
    `Remaining amount: $${remaining.toFixed(2)}.`,
    `Predicted monthly savings: $${predicted.toFixed(2)}.`,
    "Forecast uses a global model trained on historical transaction patterns.",
  ];

  // Production contract: deadline decision + probability + explainability.
  const projectedNetCashflowByDeadline =
    monthsToDeadline && Number.isFinite(predicted) ? predicted * monthsToDeadline : null;
  const projectedGoalBalanceAtDeadline =
    projectedNetCashflowByDeadline == null
      ? null
      : goal.currentAmount + projectedNetCashflowByDeadline;

  // Primary probability source: classifier output from artifacts.
  // Fallback: uncertainty-calibrated sigmoid if classifier output is unavailable.
  const spread = Math.max(1, Math.abs(high - low) / 2);
  const requirementGap =
    requiredMonthlyToHitDeadline == null ? 0 : predicted - requiredMonthlyToHitDeadline;
  const fallbackProbability =
    monthsToDeadline == null ? null : clamp01(sigmoid(requirementGap / spread));
  const classifierProbability =
    prediction.classification_probability == null
      ? null
      : clamp01(prediction.classification_probability);
  const probabilityAchievableByDeadline = classifierProbability ?? fallbackProbability;

  const achievableByDeadline =
    probabilityAchievableByDeadline == null
      ? null
      : probabilityAchievableByDeadline >= FINAL_MODEL_CONFIG.threshold;

  const inferredCompletionDate = projectedMonths
    ? addMonths(now, projectedMonths).toISOString()
    : null;

  let statusMessage = "Goal projection available.";
  if (achievableByDeadline === true) {
    statusMessage = "Projected to hit this goal on or before deadline.";
  } else if (achievableByDeadline === false && inferredCompletionDate) {
    statusMessage = "Not projected by deadline; projected to hit later if trend continues.";
  } else if (achievableByDeadline === false) {
    statusMessage = "Current savings trend is insufficient for this goal horizon.";
  }

  const explainability: GoalProjection["contract"]["explainability"] = [];
  if (requiredMonthlyToHitDeadline != null) {
    explainability.push({
      label: "Required monthly savings",
      impact: requiredMonthlyToHitDeadline <= predicted ? "positive" : "negative",
      detail: `Need about $${requiredMonthlyToHitDeadline.toFixed(2)}/month vs predicted $${predicted.toFixed(2)}/month.`,
    });
  }
  explainability.push({
    label: "Recent savings trend",
    impact: features.prev3_trend > 0 ? "positive" : features.prev3_trend < 0 ? "negative" : "neutral",
    detail: `3-month savings trend is ${features.prev3_trend >= 0 ? "improving" : "declining"} by $${Math.abs(features.prev3_trend).toFixed(2)}.`,
  });
  explainability.push({
    label: "Savings volatility",
    impact:
      features.prev3_std_savings <= Math.max(50, Math.abs(features.prev3_avg_savings) * 0.35)
        ? "positive"
        : "negative",
    detail: `Recent savings volatility is $${features.prev3_std_savings.toFixed(2)} (lower volatility is better).`,
  });
  explainability.push({
    label: "Income vs expense mix",
    impact:
      features.prev3_income_ratio > features.prev3_expense_ratio ? "positive" : "negative",
    detail: `Income ratio ${features.prev3_income_ratio.toFixed(2)} vs expense ratio ${features.prev3_expense_ratio.toFixed(2)} over last 3 months.`,
  });

  return {
    predictedMonthlySavings: predicted,
    lowMonthlySavings: low,
    highMonthlySavings: high,
    projectedMonths,
    optimisticMonths,
    pessimisticMonths,
    projectedCompletionDate,
    optimisticCompletionDate,
    pessimisticCompletionDate,
    status,
    reasoning,
    contract: {
      modelConfig: FINAL_MODEL_CONFIG,
      achievableByDeadline,
      probabilityAchievableByDeadline:
        probabilityAchievableByDeadline == null
          ? null
          : Number(probabilityAchievableByDeadline.toFixed(4)),
      projectedNetCashflowByDeadline:
        projectedNetCashflowByDeadline == null
          ? null
          : Number(projectedNetCashflowByDeadline.toFixed(2)),
      projectedGoalBalanceAtDeadline:
        projectedGoalBalanceAtDeadline == null
          ? null
          : Number(projectedGoalBalanceAtDeadline.toFixed(2)),
      requiredMonthlyToHitDeadline:
        requiredMonthlyToHitDeadline == null
          ? null
          : Number(requiredMonthlyToHitDeadline.toFixed(2)),
      predictedCompletionDate: inferredCompletionDate,
      statusMessage,
      explainability,
    },
  };
};

export const fetchGoals = async (userId: string): Promise<GoalDoc[]> => {
  const snapshot = await firestore
    .collection("users")
    .doc(userId)
    .collection("goals")
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as GoalDoc);
};

export const upsertGoal = async (userId: string, goal: GoalDoc) => {
  await firestore
    .collection("users")
    .doc(userId)
    .collection("goals")
    .doc(goal.id)
    .set(goal, { merge: true });
};

export const deleteGoal = async (userId: string, goalId: string) => {
  await firestore
    .collection("users")
    .doc(userId)
    .collection("goals")
    .doc(goalId)
    .delete();
};
