import { describe, expect, it } from "vitest";

import {
  inferCategory,
  inferTransactionType,
  normalizeDate,
  parseColumnarTransactions,
  parseSimulatedStatementTransactions,
  parseTextIntoTransactions,
  pickAmountFromLine,
  splitDescriptionAndCategory,
} from "./pdfParser";

describe("pdfParser helpers", () => {
  it("parses simple one-line statement rows", () => {
    const rows = parseTextIntoTransactions(`
      2025-01-05 Coffee Shop Dining -12.50
      2025-01-06 Direct Deposit Payroll +2500.00
    `);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      description: "Coffee Shop",
      category: "Dining",
      amount: 12.5,
      type: "expense",
    });
    expect(rows[1]).toMatchObject({
      category: "Income",
      type: "income",
    });
  });

  it("parses multi-line and month-name transaction formats", () => {
    const rows = parseTextIntoTransactions(`
      2025-01-07 Grocery Store
      Groceries
      -45.20
      8 Jan Salary Deposit
      +1200.00
    `);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      description: "Grocery Store",
      category: "Groceries",
      amount: 45.2,
    });
    expect(rows[1].type).toBe("income");
  });

  it("parses simulated statement fixtures with month aliases", () => {
    const rows = parseSimulatedStatementTransactions([
      "Jan Y2",
      "03 Grocery Run Groceries 45.00",
      "Jan 04 Paycheck Income 2500.00",
      "Date Description Category Amount",
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      description: "Grocery Run",
      category: "Groceries",
      amount: 45,
      type: "expense",
    });
    expect(rows[1].category).toBe("Income");
  });

  it("falls back to columnar parsing for section-based bank exports", () => {
    const rows = parseColumnarTransactions(
      [
        "Deposits & Other Credits",
        "01/05 Payroll Deposit 2,500.00",
        "ATM Withdrawals & Debits",
        "01/08 Corner Market 55.30",
      ],
      2025,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("income");
    expect(rows[1]).toMatchObject({
      description: "Corner Market",
      amount: 55.3,
      type: "expense",
    });
  });

  it("covers utility helpers used by the parser", () => {
    expect(normalizeDate("8 Jan 25")).toMatch(/^2025-01-08/);
    expect(splitDescriptionAndCategory("Coffee Shop Dining")).toEqual({
      description: "Coffee Shop",
      category: "Dining",
    });
    expect(pickAmountFromLine("01/08 Grocery 12.10 1450.22")).toBe("12.10");
    expect(inferTransactionType("+2500.00", "Payroll Deposit", 2500)).toBe("income");
    expect(inferCategory("Spotify subscription", "expense")).toBe("Subscriptions");
  });
});
