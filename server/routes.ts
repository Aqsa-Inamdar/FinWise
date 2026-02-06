import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertExpenseSchema, insertIncomeSchema, insertGoalSchema } from "@shared/schema";
import multer from "multer";
import { extractTransactionsFromPdf } from "./pdfParser";
import { buildMonthlyInsights } from "./insights";
import { insightSnapshotSchema } from "@shared/schema";
import { firestore } from "./firebaseAdmin";
import { getAuth } from "firebase-admin/auth";

export async function registerRoutes(app: Express): Promise<Server> {
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

  // Goal routes
  app.post("/api/goals", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const data = insertGoalSchema.parse({
        ...req.body,
        userId,
      });
      const goal = await storage.createGoal(data);
      res.json(goal);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/goals", async (req, res) => {
    try {
      const { userId } = req as Request & { userId: string };
      const goals = await storage.getGoalsByUserId(userId);
      res.json(goals);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/goals/:id", async (req, res) => {
    try {
      const goal = await storage.updateGoal(req.params.id, req.body);
      if (goal) {
        res.json(goal);
      } else {
        res.status(404).json({ error: "Goal not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/goals/:id", async (req, res) => {
    try {
      const success = await storage.deleteGoal(req.params.id);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Goal not found" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post(
    "/api/transactions/parse-pdf",
    upload.single("statement"),
    async (req, res, next) => {
      try {
        interface MulterRequest extends Express.Request {
          file?: Express.Multer.File;
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
            return res.json(parsed.data);
          }
        }
      }

      const [yearRaw, monthRaw] = monthKey.split("-");
      const year = Number(yearRaw);
      const monthIndex = Number(monthRaw) - 1;
      const start = new Date(Date.UTC(year, monthIndex, 1));
      const end = new Date(Date.UTC(year, monthIndex + 1, 1));
      const prevStart = new Date(Date.UTC(year, monthIndex - 1, 1));

      const startIso = prevStart.toISOString();
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

      const insightsSnapshot = buildMonthlyInsights(monthKey, transactions);
      await insightsRef.set(insightsSnapshot, { merge: true });

      return res.json(insightsSnapshot);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? "Failed to build insights." });
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
