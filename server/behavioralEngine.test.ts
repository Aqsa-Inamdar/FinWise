import { strict as assert } from "assert";
import {
  aggregateDailySpend,
  computeBasicStats,
  classifyVariability,
  computeCategoryEntropy,
  computeStructuralShift,
} from "./behavioralEngine";

type Txn = { date: string; amount: number; type: "income" | "expense"; category: string; description: string };

const sample: Txn[] = [
  { date: "2025-01-01T12:00:00.000Z", amount: 50, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "2025-01-01T12:00:00.000Z", amount: 25, type: "expense", category: "Dining", description: "Dining" },
  { date: "2025-01-02T12:00:00.000Z", amount: 40, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "2025-01-03T12:00:00.000Z", amount: 80, type: "expense", category: "Rent", description: "Rent" },
  { date: "2025-01-04T12:00:00.000Z", amount: 10, type: "expense", category: "Phone", description: "Phone" },
  { date: "2025-01-05T12:00:00.000Z", amount: 15, type: "expense", category: "Dining", description: "Dining" },
  { date: "2025-01-06T12:00:00.000Z", amount: 20, type: "expense", category: "Groceries", description: "Groceries" },
  { date: "2025-01-07T12:00:00.000Z", amount: 30, type: "expense", category: "Groceries", description: "Groceries" },
];

const daily = aggregateDailySpend(sample);
assert.equal(daily.size, 7);

const stats = computeBasicStats(Array.from(daily.values()));
assert.ok(stats.mean > 0);
assert.ok(stats.std >= 0);

const variability = classifyVariability(stats.cv, [0.1, 0.2, 0.4, 0.6]);
assert.ok(["LOW", "MODERATE", "HIGH"].includes(variability.label));

const entropy = computeCategoryEntropy({ Groceries: 100, Dining: 20, Rent: 80 });
assert.ok(entropy >= 0);

const shift = computeStructuralShift({ Groceries: 0.5, Rent: 0.5 }, { Groceries: 0.2, Rent: 0.8 });
assert.ok(shift > 0);

console.log("behavioralEngine tests passed");
