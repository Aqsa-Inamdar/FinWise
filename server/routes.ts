import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertExpenseSchema, insertIncomeSchema, insertGoalSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Temporary user ID for demo purposes (session-based)
  // TODO: Replace with actual authentication
  const DEMO_USER_ID = "demo-user";

  // Expense routes
  app.post("/api/expenses", async (req, res) => {
    try {
      const data = insertExpenseSchema.parse({
        ...req.body,
        userId: DEMO_USER_ID,
      });
      const expense = await storage.createExpense(data);
      res.json(expense);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/expenses", async (req, res) => {
    try {
      const expenses = await storage.getExpensesByUserId(DEMO_USER_ID);
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
      const data = insertIncomeSchema.parse({
        ...req.body,
        userId: DEMO_USER_ID,
      });
      const income = await storage.createIncome(data);
      res.json(income);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/income", async (req, res) => {
    try {
      const income = await storage.getIncomeByUserId(DEMO_USER_ID);
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
      const data = insertGoalSchema.parse({
        ...req.body,
        userId: DEMO_USER_ID,
      });
      const goal = await storage.createGoal(data);
      res.json(goal);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/goals", async (req, res) => {
    try {
      const goals = await storage.getGoalsByUserId(DEMO_USER_ID);
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

  const httpServer = createServer(app);

  return httpServer;
}
