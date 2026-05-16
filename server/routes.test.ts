import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";

const state = vi.hoisted(() => ({
  userDoc: {
    name: "Aqsa Profile",
    email: "profile@example.com",
    provider: "google",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-10T00:00:00.000Z",
  } as Record<string, any>,
  authUser: {
    uid: "user-123",
    displayName: "Aqsa Auth",
    email: "auth@example.com",
  },
  auditLogs: [] as any[],
  transactionDocs: new Map<string, any>(),
  verifyError: null as Error | null,
}));

const storageMock = vi.hoisted(() => ({
  createExpense: vi.fn(),
  getExpensesByUserId: vi.fn(),
  deleteExpense: vi.fn(),
  createIncome: vi.fn(),
  getIncomeByUserId: vi.fn(),
  deleteIncome: vi.fn(),
  createGoal: vi.fn(),
  getGoalsByUserId: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  getUser: vi.fn(),
  getUserByUsername: vi.fn(),
  createUser: vi.fn(),
}));

const goalProjectionMock = vi.hoisted(() => ({
  fetchUserNetSavings: vi.fn(),
  upsertGoal: vi.fn(),
  fetchGoals: vi.fn(),
  allocateGoalsByDeadline: vi.fn(),
  buildGoalProjection: vi.fn(),
  deleteGoal: vi.fn(),
}));

const behavioralEngineMock = vi.hoisted(() => ({
  buildBehavioralProfile: vi.fn(),
}));

const authApi = vi.hoisted(() => ({
  verifyIdToken: vi.fn(async () => {
    if (state.verifyError) throw state.verifyError;
    return {
      uid: state.authUser.uid,
      name: state.authUser.displayName,
      email: state.authUser.email,
      picture: "https://example.com/avatar.png",
    };
  }),
  getUser: vi.fn(async () => state.authUser),
  updateUser: vi.fn(async (_uid: string, _updates: Record<string, unknown>) => state.authUser),
  deleteUser: vi.fn(async () => undefined),
}));

function createTransactionsCollection() {
  return {
    doc: vi.fn((id: string) => ({
      set: vi.fn(async (payload: any) => {
        state.transactionDocs.set(id, payload);
      }),
      get: vi.fn(async () => ({
        exists: state.transactionDocs.has(id),
        data: () => state.transactionDocs.get(id),
      })),
      delete: vi.fn(async () => {
        state.transactionDocs.delete(id);
      }),
    })),
  };
}

const firestoreMock = vi.hoisted(() => ({
  batch: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => undefined),
  })),
  collection: vi.fn((name: string) => {
    if (name !== "users") throw new Error(`Unexpected root collection ${name}`);

    return {
      doc: vi.fn((_userId: string) => ({
        set: vi.fn(async (payload: any, options?: { merge?: boolean }) => {
          state.userDoc = options?.merge ? { ...state.userDoc, ...payload } : payload;
        }),
        get: vi.fn(async () => ({
          exists: true,
          data: () => state.userDoc,
        })),
        delete: vi.fn(async () => {
          state.userDoc = {};
        }),
        collection: vi.fn((subName: string) => {
          if (subName === "audit_logs") {
            return {
              add: vi.fn(async (payload: any) => {
                state.auditLogs.push(payload);
              }),
            };
          }

          if (subName === "transactions") {
            return createTransactionsCollection();
          }

          return {
            get: vi.fn(async () => ({ docs: [], empty: true, size: 0 })),
            doc: vi.fn(() => ({
              set: vi.fn(async () => undefined),
              get: vi.fn(async () => ({ exists: false, data: () => undefined })),
              delete: vi.fn(async () => undefined),
            })),
          };
        }),
      })),
    };
  }),
}));

vi.mock("./storage", () => ({
  storage: storageMock,
}));

vi.mock("./firebaseAdmin", () => ({
  firestore: firestoreMock,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => authApi),
}));

vi.mock("./services/goalProjection", () => ({
  fetchUserNetSavings: goalProjectionMock.fetchUserNetSavings,
  upsertGoal: goalProjectionMock.upsertGoal,
  fetchGoals: goalProjectionMock.fetchGoals,
  allocateGoalsByDeadline: goalProjectionMock.allocateGoalsByDeadline,
  buildGoalProjection: goalProjectionMock.buildGoalProjection,
  deleteGoal: goalProjectionMock.deleteGoal,
}));

vi.mock("./behavioralEngine", () => ({
  buildBehavioralProfile: behavioralEngineMock.buildBehavioralProfile,
}));

vi.mock("./pdfParser", () => ({
  extractTransactionsFromPdf: vi.fn(),
}));

vi.mock("./insights", () => ({
  buildMonthlyInsights: vi.fn(),
  prioritizeInsights: vi.fn(),
}));

vi.mock("./services/spendingVariability", () => ({
  runSpendingVariabilityInsight: vi.fn(),
}));

vi.mock("./services/assistantEngine", () => ({
  answerAssistantQuestion: vi.fn(),
  appendAssistantMessage: vi.fn(),
  buildQuickIntentsCached: vi.fn(),
  createAssistantThread: vi.fn(),
  exportAssistantThread: vi.fn(),
  getAssistantHealth: vi.fn(() => ({ ok: true })),
  getAssistantThreadMessages: vi.fn(),
  hardDeleteAssistantThread: vi.fn(),
  listAssistantThreads: vi.fn(),
  renameAssistantThread: vi.fn(),
}));

import { registerRoutes } from "./routes";

describe("registerRoutes", () => {
  let app: express.Express;
  let server: Awaited<ReturnType<typeof registerRoutes>>;

  beforeAll(async () => {
    app = express();
    server = await registerRoutes(app);
  });

  afterAll(async () => {
    server.close();
  });

  beforeEach(() => {
    state.userDoc = {
      name: "Aqsa Profile",
      email: "profile@example.com",
      provider: "google",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-10T00:00:00.000Z",
    };
    state.authUser = {
      uid: "user-123",
      displayName: "Aqsa Auth",
      email: "auth@example.com",
    };
    state.auditLogs = [];
    state.transactionDocs = new Map();
    state.verifyError = null;

    Object.values(storageMock).forEach((value) => {
      if ("mockReset" in value && typeof value.mockReset === "function") value.mockReset();
    });
    Object.values(goalProjectionMock).forEach((value) => {
      if ("mockReset" in value && typeof value.mockReset === "function") value.mockReset();
    });
    Object.values(behavioralEngineMock).forEach((value) => {
      if ("mockReset" in value && typeof value.mockReset === "function") value.mockReset();
    });
    authApi.verifyIdToken.mockClear();
    authApi.getUser.mockClear();
    authApi.updateUser.mockClear();
    authApi.deleteUser.mockClear();
  });

  const request = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: any } = {}) => {
    const url = new URL(path, "http://localhost");
    const query = Object.fromEntries(url.searchParams.entries());
    const req = Object.assign(new EventEmitter(), {
      method: init.method ?? "GET",
      url: path,
      originalUrl: path,
      path: url.pathname,
      headers: init.headers ?? {},
      body: init.body,
      query,
      params: {},
      get(name: string) {
        return this.headers[name.toLowerCase()];
      },
      header(name: string) {
        return this.get(name);
      },
    });

    const chunks: Buffer[] = [];
    const headers = new Map<string, string>();
    let resolved = false;

    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
      locals: {},
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), String(value));
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase());
      },
      getHeaderNames() {
        return Array.from(headers.keys());
      },
      removeHeader(name: string) {
        headers.delete(name.toLowerCase());
      },
      writeHead(statusCode: number, reasonOrHeaders?: string | Record<string, string>, maybeHeaders?: Record<string, string>) {
        this.statusCode = statusCode;
        const headerBag =
          typeof reasonOrHeaders === "object" ? reasonOrHeaders : maybeHeaders;
        if (headerBag) {
          Object.entries(headerBag).forEach(([key, value]) => this.setHeader(key, value));
        }
        this.headersSent = true;
        return this;
      },
      write(chunk: any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      end(chunk?: any) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        this.headersSent = true;
        if (!resolved) {
          resolved = true;
          this.emit("finish");
        }
        return this;
      },
    });

    await new Promise<void>((resolve, reject) => {
      res.once("finish", () => resolve());
      (app as any).handle(req, res, (error: unknown) => {
        if (error) reject(error);
        else if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });

    const rawBody = Buffer.concat(chunks).toString("utf8");

    return {
      status: res.statusCode,
      text: rawBody,
      async json() {
        return rawBody ? JSON.parse(rawBody) : null;
      },
    };
  };

  const authedRequest = (path: string, init: { method?: string; headers?: Record<string, string>; body?: any } = {}) =>
    request(path, {
      ...init,
      headers: {
        authorization: "Bearer test-token",
        ...(init.headers ?? {}),
      },
    });

  it("rejects unauthenticated API requests", async () => {
    const response = await request("/api/account");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns account data for authenticated users", async () => {
    const response = await authedRequest("/api/account");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "user-123",
      name: "Aqsa Auth",
      email: "auth@example.com",
      provider: "google",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-10T00:00:00.000Z",
    });
  });

  it("validates empty account patch requests", async () => {
    const response = await authedRequest("/api/account", {
      method: "PATCH",
      body: {},
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("At least one of name or email must be provided");
  });

  it("updates account data and writes an audit log", async () => {
    const response = await authedRequest("/api/account", {
      method: "PATCH",
      body: { name: "Updated Aqsa" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(authApi.updateUser).toHaveBeenCalledWith("user-123", { displayName: "Updated Aqsa" });
    expect(state.userDoc.name).toBe("Updated Aqsa");
    expect(state.auditLogs).toHaveLength(1);
    expect(state.auditLogs[0]).toMatchObject({
      action: "account_update",
      targetId: "user-123",
    });
  });

  it("creates an expense and mirrors it to Firestore transactions", async () => {
    storageMock.createExpense.mockResolvedValue({
      id: "expense-1",
      userId: "user-123",
      amount: "19.99",
      category: "Dining",
      description: "Lunch",
      date: new Date("2025-02-03T12:00:00.000Z"),
    });

    const response = await authedRequest("/api/expenses", {
      method: "POST",
      body: {
        amount: "19.99",
        category: "Dining",
        description: "Lunch",
        date: "2025-02-03",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(storageMock.createExpense).toHaveBeenCalled();
    expect(payload.id).toBe("expense-1");
    expect(state.transactionDocs.get("expense-1")).toMatchObject({
      id: "expense-1",
      category: "Dining",
      type: "expense",
      userId: "user-123",
    });
    expect(state.auditLogs.at(-1)).toMatchObject({
      action: "expense_create",
      targetId: "expense-1",
    });
  });

  it("creates a goal using computed net savings", async () => {
    goalProjectionMock.fetchUserNetSavings.mockResolvedValue(4200);
    goalProjectionMock.upsertGoal.mockResolvedValue(undefined);

    const response = await authedRequest("/api/goals", {
      method: "POST",
      body: {
        name: "Emergency Fund",
        targetAmount: 10000,
        deadline: "2025-12-31",
        category: "Savings",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(goalProjectionMock.fetchUserNetSavings).toHaveBeenCalledWith("user-123");
    expect(goalProjectionMock.upsertGoal).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({
        name: "Emergency Fund",
        currentAmount: 4200,
        targetAmount: 10000,
      }),
    );
    expect(payload.currentAmount).toBe(4200);
  });

  it("validates the behavioral-profile month query and returns mocked profiles", async () => {
    const badResponse = await authedRequest("/api/behavioral-profile?month=bad-month");
    expect(badResponse.status).toBe(400);

    behavioralEngineMock.buildBehavioralProfile.mockResolvedValue({
      spendingStats: { meanDailySpend: 10, stdDailySpend: 2, cv: 0.2, variabilityClass: "LOW", percentileRank: 0.1 },
      concentrationStats: { categoryEntropy: 1.2, topCategoryShare: 0.4, concentrationClass: "MODERATE" },
      savingsStats: { avgMonthlySavings: 800, stdMonthlySavings: 50, savingsCV: 0.06 },
      structuralShift: { distributionChangeScore: 0.1, shiftDetected: false },
      rollingBaselines: { threeMonthAvgSpend: 2000, threeMonthAvgSavings: 800 },
      weekdayWeekend: { weekdayAvg: 40, weekendAvg: 20, differentialPct: 0.5, meaningful: true },
    });

    const response = await authedRequest("/api/behavioral-profile?month=2025-01");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(behavioralEngineMock.buildBehavioralProfile).toHaveBeenCalledWith("user-123", "2025-01");
    expect(payload.savingsStats.avgMonthlySavings).toBe(800);
  });
});
