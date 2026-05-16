import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreState = vi.hoisted(() => ({
  transactions: [] as any[],
}));

const spawnMock = vi.hoisted(() => vi.fn());

const toSnapshot = (rows: any[]) => ({
  docs: rows.map((row) => ({
    data: () => row,
  })),
});

vi.mock("../firebaseAdmin", () => ({
  firestore: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                get: vi.fn(async () => toSnapshot(firestoreState.transactions)),
              })),
            })),
          })),
          get: vi.fn(async () => toSnapshot(firestoreState.transactions)),
        })),
      })),
    })),
  },
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

import {
  buildFeaturesFromHistory,
  computeMonthsToGoal,
  computeMonthsUntil,
  fetchMonthlySummaries,
  runPrediction,
  type MonthlySummary,
} from "./goalProjection";

function createChildProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const closeHandlers: Array<(code: number) => void> = [];
  const errorHandlers: Array<(error: Error) => void> = [];

  return {
    stdout,
    stderr,
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    on: vi.fn((event: string, handler: any) => {
      if (event === "close") closeHandlers.push(handler);
      if (event === "error") errorHandlers.push(handler);
      return undefined;
    }),
    emitClose(code: number) {
      closeHandlers.forEach((handler) => handler(code));
    },
    emitError(error: Error) {
      errorHandlers.forEach((handler) => handler(error));
    },
  };
}

describe("goalProjection helpers", () => {
  beforeEach(() => {
    firestoreState.transactions = [];
    spawnMock.mockReset();
  });

  it("computes month timelines safely", () => {
    expect(computeMonthsToGoal(500, 0)).toBeNull();
    expect(computeMonthsToGoal(500, -1)).toBeNull();
    expect(computeMonthsToGoal(500, 220)).toBe(3);

    expect(
      computeMonthsUntil(
        new Date("2025-01-31T12:00:00.000Z"),
        new Date("2025-02-01T12:00:00.000Z"),
      ),
    ).toBe(1);
    expect(
      computeMonthsUntil(
        new Date("2025-01-15T12:00:00.000Z"),
        new Date("2025-04-01T12:00:00.000Z"),
      ),
    ).toBe(3);
  });

  it("builds rolling ML features from the latest three months", () => {
    const history: MonthlySummary[] = [
      { year: 2024, monthIndex: 10, income: 3000, expense: 2500, savings: 500, txnCount: 12, totalFlow: 5500 },
      { year: 2024, monthIndex: 11, income: 3100, expense: 2400, savings: 700, txnCount: 10, totalFlow: 5500 },
      { year: 2025, monthIndex: 0, income: 3200, expense: 2600, savings: 600, txnCount: 14, totalFlow: 5800 },
    ];

    expect(buildFeaturesFromHistory(history.slice(0, 2))).toBeNull();

    const features = buildFeaturesFromHistory(history);
    expect(features).not.toBeNull();
    expect(features?.prev3_avg_savings).toBeCloseTo(600);
    expect(features?.lag1_savings).toBe(600);
    expect(features?.lag2_savings).toBe(700);
    expect(features?.month_num).toBe(2);
  });

  it("groups transactions into monthly summaries and skips invalid dates", async () => {
    firestoreState.transactions = [
      { date: "2025-01-02T12:00:00.000Z", amount: 2000, type: "income" },
      { date: "2025-01-05T12:00:00.000Z", amount: 700, type: "expense" },
      { date: "2025-02-02T12:00:00.000Z", amount: 2100, type: "income" },
      { date: "2025-02-06T12:00:00.000Z", amount: 800, type: "expense" },
      { date: "bad-date", amount: 999, type: "expense" },
    ];

    const summaries = await fetchMonthlySummaries("user-1", 6, new Date("2025-02-10T12:00:00.000Z"));

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      year: 2025,
      monthIndex: 0,
      income: 2000,
      expense: 700,
      savings: 1300,
      txnCount: 2,
    });
    expect(summaries[1].savings).toBe(1300);
  });

  it("runs the Python predictor and parses JSON output", async () => {
    const child = createChildProcess();
    spawnMock.mockReturnValue(child);

    const predictionPromise = runPrediction({ prev3_avg_savings: 500, month_num: 2 });
    child.stdout.emit("data", Buffer.from('{"predicted_savings":500,"low_savings":300,"high_savings":700,"residual_std":200,"classification_probability":0.77}'));
    child.emitClose(0);

    await expect(predictionPromise).resolves.toMatchObject({
      predicted_savings: 500,
      classification_probability: 0.77,
    });
    expect(child.stdin.write).toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("rejects when the predictor exits non-zero or emits invalid JSON", async () => {
    const failedChild = createChildProcess();
    spawnMock.mockReturnValueOnce(failedChild);

    const failedPromise = runPrediction({ prev3_avg_savings: 500 });
    failedChild.stderr.emit("data", Buffer.from("boom"));
    failedChild.emitClose(1);
    await expect(failedPromise).rejects.toThrow(/Goal prediction script failed/);

    const invalidChild = createChildProcess();
    spawnMock.mockReturnValueOnce(invalidChild);

    const invalidPromise = runPrediction({ prev3_avg_savings: 500 });
    invalidChild.stdout.emit("data", Buffer.from("not-json"));
    invalidChild.emitClose(0);
    await expect(invalidPromise).rejects.toThrow();
  });
});
