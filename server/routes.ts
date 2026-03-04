import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertExpenseSchema, insertIncomeSchema } from "@shared/schema";
import multer from "multer";
import { extractTransactionsFromPdf } from "./pdfParser";
import { buildMonthlyInsights, prioritizeInsights } from "./insights";
import { buildBehavioralProfile } from "./behavioralEngine";
import { runSpendingVariabilityInsight } from "./services/spendingVariability";
import { insightSnapshotSchema } from "@shared/schema";
import { firestore } from "./firebaseAdmin";
import { getAuth } from "firebase-admin/auth";
import type { CollectionReference } from "firebase-admin/firestore";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  allocateGoalsByDeadline,
  buildGoalProjection,
  deleteGoal,
  fetchGoals,
  fetchUserNetSavings,
  upsertGoal,
  type GoalDoc,
} from "./services/goalProjection";
import {
  answerAssistantQuestion,
  appendAssistantMessage,
  buildQuickIntentsCached,
  createAssistantThread,
  exportAssistantThread,
  getAssistantHealth,
  getAssistantThreadMessages,
  hardDeleteAssistantThread,
  listAssistantThreads,
  renameAssistantThread,
} from "./services/assistantEngine";

export async function registerRoutes(app: Express): Promise<Server> {
  const getUserId = (req: Request): string => {
    return (req as unknown as Request & { userId: string }).userId;
  };

  const sanitizeQuestionForLogs = (question: string) =>
    question
      .replace(/\b\d{12,19}\b/g, "[redacted-card]")
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
      .slice(0, 200);

  const writeAuditLog = async (
    userId: string,
    action: string,
    targetId: string,
    metadata?: Record<string, unknown>,
  ) => {
    await firestore
      .collection("users")
      .doc(userId)
      .collection("audit_logs")
      .add({
        action,
        targetId,
        createdAt: new Date().toISOString(),
        ...(metadata ? { metadata } : {}),
      });
  };

  const deleteCollectionDocuments = async (collectionRef: CollectionReference, batchSize = 250) => {
    while (true) {
      const snapshot = await collectionRef.limit(batchSize).get();
      if (snapshot.empty) break;
      const batch = firestore.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      if (snapshot.size < batchSize) break;
    }
  };

  const authenticateRequest = async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const decoded = await getAuth().verifyIdToken(token);
      (req as Request & { userId: string; userName?: string; userEmail?: string }).userId =
        decoded.uid;
      (req as Request & { userId: string; userName?: string; userEmail?: string }).userName =
        decoded.name || decoded.email || "Unknown User";
      (req as Request & { userId: string; userName?: string; userEmail?: string }).userEmail =
        decoded.email;

      // Keep a user profile document updated for visibility in Firestore
      await firestore
        .collection("users")
        .doc(decoded.uid)
        .set(
          {
            id: decoded.uid,
            name: decoded.name || null,
            email: decoded.email || null,
            photoURL: decoded.picture || null,
            lastSeenAt: new Date().toISOString(),
          },
          { merge: true }
        );
      return next();
    } catch (error: any) {
      if (app.get("env") === "development") {
        console.error("Firebase auth error:", error);
        return res.status(401).json({
          error: "Unauthorized",
          details: error?.message ?? String(error),
        });
      }
      return res.status(401).json({ error: "Unauthorized" });
    }
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  app.use("/api", authenticateRequest);

  const accountPatchSchema = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      email: z.string().trim().email().optional(),
    })
    .refine((value) => Boolean(value.name || value.email), {
      message: "At least one of name or email must be provided.",
    });

  app.get("/api/account", async (req, res) => {
    try {
      const userId = getUserId(req);
      const authUser = await getAuth().getUser(userId);
      const userDoc = await firestore.collection("users").doc(userId).get();
      const profile = userDoc.exists ? userDoc.data() : {};
      return res.json({
        id: userId,
        name: profile?.name ?? authUser.displayName ?? "",
        email: profile?.email ?? authUser.email ?? "",
        provider: profile?.provider ?? null,
        createdAt: profile?.createdAt ?? null,
        updatedAt: profile?.updatedAt ?? null,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to load account." });
    }
  });

  app.patch("/api/account", async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = accountPatchSchema.parse(req.body);

      const authUpdates: { displayName?: string; email?: string } = {};
      if (parsed.name) authUpdates.displayName = parsed.name;
      if (parsed.email) authUpdates.email = parsed.email;
      if (Object.keys(authUpdates).length) {
        await getAuth().updateUser(userId, authUpdates);
      }

      await firestore
        .collection("users")
        .doc(userId)
        .set(
          {
            ...(parsed.name ? { name: parsed.name } : {}),
            ...(parsed.email ? { email: parsed.email } : {}),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );

      await writeAuditLog(userId, "account_update", userId, {
        updatedName: Boolean(parsed.name),
        updatedEmail: Boolean(parsed.email),
      });

      return res.json({ success: true });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message ?? "Failed to update account." });
    }
  });

  app.delete("/api/account", async (req, res) => {
    try {
      const userId = getUserId(req);
      const userRef = firestore.collection("users").doc(userId);

      const assistantChats = await userRef.collection("assistant_chats").get();
      for (const chatDoc of assistantChats.docs) {
        await deleteCollectionDocuments(chatDoc.ref.collection("messages"));
      }
      await deleteCollectionDocuments(userRef.collection("assistant_chats"));
      await deleteCollectionDocuments(userRef.collection("goals"));
      await deleteCollectionDocuments(userRef.collection("insights"));
      await deleteCollectionDocuments(userRef.collection("transactions"));
      await deleteCollectionDocuments(userRef.collection("audit_logs"));

      await userRef.delete();
      await getAuth().deleteUser(userId);

      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to delete account." });
    }
  });

  // Expense routes
  app.post("/api/expenses", async (req, res) => {
    try {
      const { userId, userName, userEmail } = req as Request & {
        userId: string;
        userName?: string;
        userEmail?: string;
      };
      const dateValue = req.body?.date ? new Date(req.body.date) : undefined;
      const data = insertExpenseSchema.parse({
        ...req.body,
        userId,
        ...(dateValue ? { date: dateValue } : {}),
      });
      const expense = await storage.createExpense(data);
      const expenseDate = new Date(expense.date);
      await firestore
        .collection("users")
        .doc(userId)
        .collection("transactions")
        .doc(expense.id)
        .set({
          id: expense.id,
          date: expenseDate.toISOString(),
          description: expense.description,
          category: expense.category,
          amount: Number(expense.amount),
          type: "expense",
          userId,
          userName: userName ?? null,
          userEmail: userEmail ?? null,
        });
      await writeAuditLog(userId, "expense_create", expense.id, {
        amount: Number(expense.amount),
        category: expense.category,
      });
      res.json(expense);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/expenses", async (req, res) => {
    try {
      const { userId, userName, userEmail } = req as Request & {
        userId: string;
        userName?: string;
        userEmail?: string;
      };
      const expenses = await storage.getExpensesByUserId(userId);
      res.json(expenses);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/expenses/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const success = await storage.deleteExpense(req.params.id);
      if (success) {
        await writeAuditLog(userId, "expense_delete", req.params.id);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Expense not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Income routes
  app.post("/api/income", async (req, res) => {
    try {
      const { userId, userName, userEmail } = req as Request & {
        userId: string;
        userName?: string;
        userEmail?: string;
      };
      const dateValue = req.body?.date ? new Date(req.body.date) : undefined;
      const data = insertIncomeSchema.parse({
        ...req.body,
        userId,
        ...(dateValue ? { date: dateValue } : {}),
      });
      const income = await storage.createIncome(data);
      const incomeDate = new Date(income.date);
      await firestore
        .collection("users")
        .doc(userId)
        .collection("transactions")
        .doc(income.id)
        .set({
          id: income.id,
          date: incomeDate.toISOString(),
          description: income.description || income.source,
          category: "Income",
          amount: Number(income.amount),
          type: "income",
          userId,
          userName: userName ?? null,
          userEmail: userEmail ?? null,
        });
      await writeAuditLog(userId, "income_create", income.id, {
        amount: Number(income.amount),
        source: income.source,
      });
      res.json(income);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/income", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const income = await storage.getIncomeByUserId(userId);
      res.json(income);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/income/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const success = await storage.deleteIncome(req.params.id);
      if (success) {
        await writeAuditLog(userId, "income_delete", req.params.id);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Income not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const goalInputSchema = z.object({
    name: z.string().min(1),
    targetAmount: z.coerce.number().positive(),
    // Backward compatibility: older clients may still send currentAmount.
    // We ignore it and always compute server-side from transactions.
    currentAmount: z
      .preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.number().min(0))
      .optional(),
    allocationOverride: z
      .union([
        z.null(),
        z.preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.number().min(0)),
      ])
      .optional(),
    deadline: z
      .string()
      .min(1)
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: "Deadline must be a valid date.",
      }),
    category: z.string().optional().nullable(),
  });

  const goalUpdateSchema = goalInputSchema.partial();

  // Goal routes (Firestore)
  app.post("/api/goals", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const parsed = goalInputSchema.parse(req.body);
      const nowIso = new Date().toISOString();
      const computedCurrentAmount = await fetchUserNetSavings(userId);
      const goal: GoalDoc = {
        id: randomUUID(),
        name: parsed.name,
        targetAmount: parsed.targetAmount,
        currentAmount: computedCurrentAmount,
        allocationOverride: parsed.allocationOverride ?? null,
        deadline: parsed.deadline,
        category: parsed.category ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await upsertGoal(userId, goal);
      await writeAuditLog(userId, "goal_create", goal.id, {
        name: goal.name,
        targetAmount: goal.targetAmount,
        deadline: goal.deadline,
      });
      res.json(goal);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/goals", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const goals = await fetchGoals(userId);
      const computedCurrentAmount = await fetchUserNetSavings(userId);
      const allocatedGoals = allocateGoalsByDeadline(goals, computedCurrentAmount);
      const enriched = await Promise.all(
        allocatedGoals.map(async (goalWithComputedSavings) => {
          return {
            ...goalWithComputedSavings,
            projection: await buildGoalProjection(userId, goalWithComputedSavings),
          };
        })
      );
      res.json({ goals: enriched, totalSavingsPool: Math.max(0, computedCurrentAmount) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/goals/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = goalUpdateSchema.parse(req.body);
      const goals = await fetchGoals(userId);
      const existing = goals.find((goal) => goal.id === req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Goal not found" });
      }
      const { currentAmount: _ignoredCurrentAmount, ...safeParsed } = parsed;
      const updated: GoalDoc = {
        ...existing,
        ...safeParsed,
        updatedAt: new Date().toISOString(),
      };
      await upsertGoal(userId, updated);
      await writeAuditLog(userId, "goal_update", updated.id, {
        name: updated.name,
        targetAmount: updated.targetAmount,
        deadline: updated.deadline,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/goals/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      await deleteGoal(userId, req.params.id);
      await writeAuditLog(userId, "goal_delete", req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post(
    "/api/transactions/parse-pdf",
    upload.single("statement"),
    async (req, res, next) => {
      try {
        interface MulterRequest extends Request {
          file?: {
            buffer: Buffer;
            size: number;
          };
        }
        const mReq = req as MulterRequest;
        const { userId, userName, userEmail } = req as Request & {
          userId: string;
          userName?: string;
          userEmail?: string;
        };
        if (!mReq.file) {
          console.error("No PDF file uploaded");
          return res.status(400).json({ error: "PDF statement is required" });
        }

        console.log("PDF file received, size:", mReq.file.size);
        const transactions = await extractTransactionsFromPdf(mReq.file.buffer);
        console.log("Extracted transactions:", transactions);

        // Log transactions to Firestore under the authenticated user
        if (transactions.length > 0) {
          const batch = firestore.batch();
          transactions.forEach((txn) => {
            const docRef = firestore
              .collection("users")
              .doc(userId)
              .collection("transactions")
              .doc(txn.id);
            batch.set(docRef, {
              ...txn,
              userId,
              userName: userName ?? null,
              userEmail: userEmail ?? null,
            });
          });
          await batch.commit();
          console.log(`Logged ${transactions.length} transactions to Firestore.`);
        } else {
          console.log("No transactions extracted from PDF.");
        }
        res.json({ transactions });
      } catch (error) {
        console.error("Error in /api/transactions/parse-pdf:", error);
        next(error);
      }
    }
  );

  app.get("/api/insights", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const monthParam = typeof req.query.month === "string" ? req.query.month : "";
      const refresh = req.query.refresh === "1";
      const now = new Date();
      const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const monthKey = monthParam || defaultMonth;

      const monthMatch = /^\d{4}-\d{2}$/.test(monthKey);
      if (!monthMatch) {
        return res.status(400).json({ error: "Month must be in YYYY-MM format." });
      }

      const insightsRef = firestore
        .collection("users")
        .doc(userId)
        .collection("insights")
        .doc(monthKey);

      if (!refresh) {
        const snapshot = await insightsRef.get();
        if (snapshot.exists) {
          const data = snapshot.data();
          const parsed = insightSnapshotSchema.safeParse(data);
          if (parsed.success) {
            const hasExecutive = parsed.data.insights.some(
              (insight) => insight.type === "executive_summary"
            );
            if (hasExecutive) {
              return res.json(parsed.data);
            }
          }
        }
      }

      const [yearRaw, monthRaw] = monthKey.split("-");
      const year = Number(yearRaw);
      const monthIndex = Number(monthRaw) - 1;
      const start = new Date(Date.UTC(year, monthIndex, 1));
      const end = new Date(Date.UTC(year, monthIndex + 1, 1));
      const sixMonthsBack = new Date(Date.UTC(year, monthIndex - 6, 1));

      const startIso = sixMonthsBack.toISOString();
      const endIso = end.toISOString();

      const transactionsSnapshot = await firestore
        .collection("users")
        .doc(userId)
        .collection("transactions")
        .where("date", ">=", startIso)
        .where("date", "<", endIso)
        .orderBy("date", "asc")
        .get();

      const transactions = transactionsSnapshot.docs.map((doc) => doc.data()) as Array<{
        date: string;
        description: string;
        category: string;
        amount: number | string;
        type: "income" | "expense";
      }>;

      const behavioralProfile = await buildBehavioralProfile(userId, monthKey);
      const insightsSnapshot = buildMonthlyInsights(monthKey, transactions, behavioralProfile);

      const variabilityInsight = await runSpendingVariabilityInsight(userId, monthKey);
      if (variabilityInsight) {
        insightsSnapshot.insights = prioritizeInsights([
          ...insightsSnapshot.insights,
          variabilityInsight,
        ]);
      }

      await insightsRef.set(insightsSnapshot, { merge: true });

      return res.json(insightsSnapshot);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to build insights." });
    }
  });

  app.get("/api/behavioral-profile", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const monthParam = typeof req.query.month === "string" ? req.query.month : "";
      const now = new Date();
      const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const monthKey = monthParam || defaultMonth;
      if (!/^\d{4}-\d{2}$/.test(monthKey)) {
        return res.status(400).json({ error: "Month must be in YYYY-MM format." });
      }
      const profile = await buildBehavioralProfile(userId, monthKey);
      return res.json(profile);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to build behavioral profile." });
    }
  });

  const assistantQuerySchema = z.object({
    question: z.string().min(1).max(500),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    selectedGoalId: z.string().optional().nullable(),
    chatId: z.string().optional().nullable(),
  });

  app.get("/api/assistant/health", async (_req, res) => {
    return res.json(getAssistantHealth());
  });

  app.get("/api/assistant/chats", async (req, res) => {
    try {
      const userId = getUserId(req);
      const chats = await listAssistantThreads(userId);
      return res.json({ chats });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to load chats." });
    }
  });

  app.post("/api/assistant/chats", async (req, res) => {
    try {
      const userId = getUserId(req);
      const title = typeof req.body?.title === "string" && req.body.title.trim()
        ? req.body.title.trim()
        : "New Chat";
      const chatId = await createAssistantThread(userId, title);
      await writeAuditLog(userId, "assistant_chat_create", chatId, { title });
      return res.json({ chatId });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to create chat." });
    }
  });

  app.get("/api/assistant/chats/:id/messages", async (req, res) => {
    try {
      const userId = getUserId(req);
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
      const messages = await getAssistantThreadMessages(userId, req.params.id, limit);
      return res.json({ messages });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to load messages." });
    }
  });

  app.patch("/api/assistant/chats/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const title = typeof req.body?.title === "string" ? req.body.title : "";
      if (!title.trim()) return res.status(400).json({ error: "title is required." });
      await renameAssistantThread(userId, req.params.id, title);
      await writeAuditLog(userId, "assistant_chat_rename", req.params.id);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to rename chat." });
    }
  });

  app.delete("/api/assistant/chats/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      await hardDeleteAssistantThread(userId, req.params.id);
      await writeAuditLog(userId, "assistant_chat_delete", req.params.id);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to delete chat." });
    }
  });

  app.get("/api/assistant/chats/:id/export", async (req, res) => {
    try {
      const userId = getUserId(req);
      const payload = await exportAssistantThread(userId, req.params.id);
      return res.json(payload);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to export chat." });
    }
  });

  app.get("/api/assistant/quick-intents", async (req, res) => {
    try {
      const userId = getUserId(req);
      const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
      const endDate = typeof req.query.endDate === "string" ? req.query.endDate : "";
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required." });
      }
      const intents = await buildQuickIntentsCached({ userId, startDate, endDate });
      return res.json({ intents });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to load quick intents." });
    }
  });

  app.post("/api/assistant/query", async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = assistantQuerySchema.parse(req.body);
      let chatId = parsed.chatId ?? null;
      if (!chatId) {
        chatId = await createAssistantThread(userId, parsed.question.slice(0, 80));
      }

      const history = await getAssistantThreadMessages(userId, chatId, 8);
      const chatHistory = history
        .map((m) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          text: String(m.text ?? ""),
        }))
        .filter((m) => m.text.trim().length > 0);

      await appendAssistantMessage({
        userId,
        chatId,
        role: "user",
        text: parsed.question,
        payload: {
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          selectedGoalId: parsed.selectedGoalId ?? null,
        },
      });

      const response = await answerAssistantQuestion({
        userId,
        question: parsed.question,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        selectedGoalId: parsed.selectedGoalId ?? null,
        chatHistory,
      });

      await appendAssistantMessage({
        userId,
        chatId,
        role: "assistant",
        text: response.answerSummary,
        payload: response as unknown as Record<string, unknown>,
      });

      await writeAuditLog(userId, "assistant_query", chatId, {
        question: sanitizeQuestionForLogs(parsed.question),
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        selectedGoalId: parsed.selectedGoalId ?? null,
        intent: response.intent,
        subIntent: response.subIntent,
        confidence: response.confidence,
      });

      return res.json({ chatId, response });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message ?? "Assistant query failed." });
    }
  });

  app.use((err: any, _req: any, res: any, next: any) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  });

  const httpServer = createServer(app);

  return httpServer;
}
