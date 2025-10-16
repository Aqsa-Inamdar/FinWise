import { 
  type User, 
  type InsertUser, 
  type Expense, 
  type InsertExpense,
  type Income,
  type InsertIncome,
  type Goal,
  type InsertGoal
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  createExpense(expense: InsertExpense): Promise<Expense>;
  getExpensesByUserId(userId: string): Promise<Expense[]>;
  deleteExpense(id: string): Promise<boolean>;
  
  createIncome(income: InsertIncome): Promise<Income>;
  getIncomeByUserId(userId: string): Promise<Income[]>;
  deleteIncome(id: string): Promise<boolean>;
  
  createGoal(goal: InsertGoal): Promise<Goal>;
  getGoalsByUserId(userId: string): Promise<Goal[]>;
  updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined>;
  deleteGoal(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private expenses: Map<string, Expense>;
  private income: Map<string, Income>;
  private goals: Map<string, Goal>;

  constructor() {
    this.users = new Map();
    this.expenses = new Map();
    this.income = new Map();
    this.goals = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createExpense(insertExpense: InsertExpense): Promise<Expense> {
    const id = randomUUID();
    const expense: Expense = { 
      ...insertExpense, 
      id,
      date: insertExpense.date || new Date()
    };
    this.expenses.set(id, expense);
    return expense;
  }

  async getExpensesByUserId(userId: string): Promise<Expense[]> {
    return Array.from(this.expenses.values())
      .filter((expense) => expense.userId === userId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async deleteExpense(id: string): Promise<boolean> {
    return this.expenses.delete(id);
  }

  async createIncome(insertIncome: InsertIncome): Promise<Income> {
    const id = randomUUID();
    const income: Income = { 
      ...insertIncome, 
      id,
      date: insertIncome.date || new Date()
    };
    this.income.set(id, income);
    return income;
  }

  async getIncomeByUserId(userId: string): Promise<Income[]> {
    return Array.from(this.income.values())
      .filter((income) => income.userId === userId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async deleteIncome(id: string): Promise<boolean> {
    return this.income.delete(id);
  }

  async createGoal(insertGoal: InsertGoal): Promise<Goal> {
    const id = randomUUID();
    const goal: Goal = { 
      ...insertGoal, 
      id,
      currentAmount: insertGoal.currentAmount || "0"
    };
    this.goals.set(id, goal);
    return goal;
  }

  async getGoalsByUserId(userId: string): Promise<Goal[]> {
    return Array.from(this.goals.values())
      .filter((goal) => goal.userId === userId);
  }

  async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined> {
    const goal = this.goals.get(id);
    if (!goal) return undefined;
    
    const updatedGoal = { ...goal, ...updates };
    this.goals.set(id, updatedGoal);
    return updatedGoal;
  }

  async deleteGoal(id: string): Promise<boolean> {
    return this.goals.delete(id);
  }
}

export const storage = new MemStorage();
