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
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  buildGoalProjection,
  deleteGoal,
  fetchGoals,
  fetchUserNetSavings,
  upsertGoal,
  type GoalDoc,
} from "./services/goalProjection";

export async function registerRoutes(app: Express): Promise<Server> {
  const getUserId = (req: Request): string => {
    return (req as unknown as Request & { userId: string }).userId;
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
      const success = await storage.deleteExpense(req.params.id);
      if (success) {
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
      const success = await storage.deleteIncome(req.params.id);
      if (success) {
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

  type AllocatedGoal = GoalDoc & { savingsLeftAfterGoal: number };

  const allocateSavingsByDeadline = (goals: GoalDoc[], totalSavings: number): AllocatedGoal[] => {
    const availablePool = Math.max(0, totalSavings);
    let remainingPool = availablePool;

    // Allocate finite deadlines first, then goals without valid deadlines.
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
      const allocatedGoals = allocateSavingsByDeadline(goals, computedCurrentAmount);
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
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/goals/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      await deleteGoal(userId, req.params.id);
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

  app.use((err: any, _req: any, res: any, next: any) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  });

  const httpServer = createServer(app);

  return httpServer;
}
