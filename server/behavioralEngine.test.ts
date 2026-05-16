import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  currentTransactions: [] as any[],
  allTransactions: [] as any[],
  insights: [] as any[],
}));

const toSnapshot = (rows: any[]) => ({
  docs: rows.map((row) => ({
    data: () => row,
  })),
});

vi.mock("./firebaseAdmin", () => ({
  firestore: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn((name: string) => {
          if (name === "transactions") {
            return {
              where: vi.fn(() => ({
                where: vi.fn(() => ({
                  get: vi.fn(async () => toSnapshot(state.currentTransactions)),
                })),
              })),
              get: vi.fn(async () => toSnapshot(state.allTransactions)),
            };
          }

          if (name === "insights") {
            return {
              get: vi.fn(async () => toSnapshot(state.insights)),
            };
          }

          return {};
        }),
      })),
    })),
  },
}));

import {
  aggregateDailySpend,
  buildBehavioralProfile,
  classifyVariability,
  computeBasicStats,
  computeCategoryEntropy,
  computeStructuralShift,
  computeWeekdayWeekend,
} from "./behavioralEngine";

type Txn = {
  date: string;
  amount: number | string;
  type: "income" | "expense";
  category: string;
  description: string;
};

const januaryTransactions: Txn[] = [
  { date: "2025-01-01T12:00:00.000Z", amount: 50, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "2025-01-01T15:00:00.000Z", amount: "25", type: "expense", category: "Dining", description: "Dining" },
  { date: "2025-01-02T12:00:00.000Z", amount: 40, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "2025-01-03T12:00:00.000Z", amount: 80, type: "expense", category: "Rent", description: "Rent" },
  { date: "2025-01-04T12:00:00.000Z", amount: 10, type: "expense", category: "Phone", description: "Phone" },
  { date: "2025-01-05T12:00:00.000Z", amount: 15, type: "expense", category: "Dining", description: "Dining" },
  { date: "2025-01-06T12:00:00.000Z", amount: 20, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "2025-01-07T12:00:00.000Z", amount: 30, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "invalid-date", amount: 999, type: "expense", category: "Ignored", description: "Ignored" },
  { date: "2025-01-07T12:00:00.000Z", amount: 2500, type: "income", category: "Income", description: "Payroll" },
];

describe("behavioralEngine", () => {
  beforeEach(() => {
    state.currentTransactions = [];
    state.allTransactions = [];
    state.insights = [];
  });

  it("aggregates expense spending by UTC day and ignores invalid rows", () => {
    const daily = aggregateDailySpend(januaryTransactions);

    expect(daily.size).toBe(7);
    expect(daily.get("2025-01-01")).toBe(75);
    expect(daily.get("2025-01-03")).toBe(80);
    expect(daily.has("invalid-date")).toBe(false);
  });

  it("computes basic statistics and handles empty inputs", () => {
    const daily = aggregateDailySpend(januaryTransactions);
    const stats = computeBasicStats(Array.from(daily.values()));

    expect(stats.mean).toBeGreaterThan(0);
    expect(stats.std).toBeGreaterThanOrEqual(0);
    expect(stats.max).toBe(80);
    expect(stats.min).toBe(10);
    expect(computeBasicStats([])).toEqual({ mean: 0, std: 0, min: 0, max: 0, cv: 0 });
  });

  it("classifies variability with and without historical baselines", () => {
    expect(classifyVariability(0.1, []).label).toBe("LOW");
    expect(classifyVariability(0.35, []).label).toBe("MODERATE");
    expect(classifyVariability(0.8, []).label).toBe("HIGH");

    const daily = aggregateDailySpend(januaryTransactions);
    const stats = computeBasicStats(Array.from(daily.values()));
    const variability = classifyVariability(stats.cv, [0.1, 0.2, 0.4, 0.6]);

    expect(["LOW", "MODERATE", "HIGH"]).toContain(variability.label);
    expect(variability.percentileRank).not.toBeNull();
  });

  it("computes entropy, structural shift, and zero-total edge cases", () => {
    const entropy = computeCategoryEntropy({ Groceries: 100, Dining: 20, Rent: 80 });
    const shift = computeStructuralShift(
      { Groceries: 0.5, Rent: 0.5 },
      { Groceries: 0.2, Rent: 0.8 },
    );

    expect(entropy).toBeGreaterThanOrEqual(0);
    expect(computeCategoryEntropy({})).toBe(0);
    expect(shift).toBeGreaterThan(0);
    expect(computeStructuralShift({ Groceries: 1 }, {})).toBe(0.5);
  });

  it("marks weekday/weekend patterns meaningful only when data thresholds are met", () => {
    const meaningful = computeWeekdayWeekend(januaryTransactions);
    const insufficient = computeWeekdayWeekend([
      { date: "2025-01-04T12:00:00.000Z", amount: 100, type: "expense", category: "Dining", description: "Dining" },
      { date: "2025-01-05T12:00:00.000Z", amount: 20, type: "expense", category: "Dining", description: "Dining" },
    ]);

    expect(meaningful.meaningful).toBe(true);
    expect(meaningful.weekdayAvg).toBeGreaterThan(meaningful.weekendAvg);
    expect(insufficient.meaningful).toBe(false);
  });

  it("builds a behavioral profile from mocked Firestore snapshots", async () => {
    state.currentTransactions = januaryTransactions;
    state.allTransactions = [
      { date: "2024-12-02T12:00:00.000Z", amount: 100, type: "expense", category: "Travel", description: "Flight" },
      { date: "2024-12-10T12:00:00.000Z", amount: 1500, type: "income", category: "Income", description: "Payroll" },
      { date: "2025-01-01T12:00:00.000Z", amount: 50, type: "expense", category: "Groceries", description: "Groceries" },
      { date: "2025-01-15T12:00:00.000Z", amount: 2500, type: "income", category: "Income", description: "Payroll" },
      { date: "2025-02-03T12:00:00.000Z", amount: 80, type: "expense", category: "Rent", description: "Rent" },
      { date: "2025-02-12T12:00:00.000Z", amount: 2600, type: "income", category: "Income", description: "Payroll" },
      { date: "not-a-date", amount: 10, type: "expense", category: "Ignored", description: "Ignored" },
      ...januaryTransactions,
    ];
    state.insights = [
      { variabilityStats: { cv: 0.12 } },
      { variabilityStats: { cv: 0.22 } },
      { variabilityStats: { cv: 0.7 } },
    ];

    const profile = await buildBehavioralProfile("user-1", "2025-01");

    expect(profile.spendingStats.variabilityClass).not.toBe("INSUFFICIENT_DATA");
    expect(profile.spendingStats.percentileRank).not.toBeNull();
    expect(profile.concentrationStats.topCategoryShare).toBeGreaterThan(0);
    expect(profile.structuralShift.shiftDetected).toBe(true);
    expect(profile.rollingBaselines.threeMonthAvgSavings).toBeGreaterThan(0);
    expect(profile.weekdayWeekend.meaningful).toBe(true);
  });
});
