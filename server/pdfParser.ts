import { randomUUID } from "crypto";
import { createRequire } from "module";
import { pathToFileURL } from "url";
// Removed problematic type-only import for TextResult
import fs from "fs";
import path from "path";

import { createCanvas } from "canvas";



interface PdfParseInstance {
  getText: () => Promise<any>;
  destroy?: () => Promise<void>;
}
type PdfParseClass = new (options: { data: Buffer | Uint8Array }) => PdfParseInstance;

const require = createRequire(import.meta.url);
const pdfParseBindings: any = require("pdf-parse");
const PdfParseConstructor: PdfParseClass | undefined = pdfParseBindings?.PDFParse;
if (!PdfParseConstructor || typeof PdfParseConstructor !== "function") {
  throw new Error("Failed to load pdf-parse module.");
}

const tesseractPromise = import("tesseract.js");

export type ParsedStatementTransaction = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: "income" | "expense";
};

const LINE_REGEX =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+?)\s+([+-]?\$?\d[\d,]*\.\d{2})$/;
const ENTRY_START_REGEX =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+)/;
const DATE_NAME_START_REGEX = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?\s+(.+)/;
const DATE_NAME_END_REGEX = /^(.+?)\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/;
const MONTH_ALIAS_HEADER_REGEX = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+Y(\d+)$/i;
const SIMULATED_ROW_WITH_MONTH_REGEX =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})\s+(.+?)\s+(Income|Rent|Rent\/Housing|Utilities|Internet|Phone|Groceries|Transport|Dining|Shopping|Subscriptions|EMI\/Loan|Healthcare|Entertainment|Travel|General|Uncategorized)\s+([+-]?\d[\d,]*\.\d{2})$/i;
const SIMULATED_ROW_DAY_ONLY_REGEX =
  /^(\d{2})\s+(.+?)\s+(Income|Rent|Rent\/Housing|Utilities|Internet|Phone|Groceries|Transport|Dining|Shopping|Subscriptions|EMI\/Loan|Healthcare|Entertainment|Travel|General|Uncategorized)\s+([+-]?\d[\d,]*\.\d{2})$/i;
const AMOUNT_ONLY_REGEX = /^([+-]?\$?\s?\d[\d,]*\.\d{2})$/;
const AMOUNT_REGEX = /[+-]?\$?\d[\d,]*\.\d{2}/g;
const DATE_TOKEN_REGEX = /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/;
const SECTION_HEADERS = [
  "deposits & other credits",
  "atm withdrawals & debits",
  "visa check card purchases & debits",
  "withdrawals & other debits",
  "checks paid",
];

const categoryKeywords: Record<string, string[]> = {
  rent: ["rent", "mortgage", "lease", "apartment", "housing"],
  groceries: ["grocery", "market", "mart", "superstore", "walmart", "aldi", "costco"],
  dining: ["cafe", "restaurant", "coffee", "diner", "eatery"],
  transport: ["uber", "lyft", "gas", "fuel", "shell", "chevron", "transport"],
  entertainment: ["movie", "cinema", "concert", "ticket", "game", "entertainment"],
  subscriptions: ["subscription", "netflix", "spotify", "membership"],
  healthcare: ["clinic", "pharmacy", "doctor", "hospital", "medical", "dentist"],
  emi_loan: ["emi", "loan", "installment", "mortgage payment", "car payment"],
  income: ["salary", "payroll", "deposit", "paycheck", "direct deposit"],
};
const knownCategoryLabels = [
  "Income",
  "Rent",
  "Rent/Housing",
  "Utilities",
  "Internet",
  "Phone",
  "Groceries",
  "Transport",
  "Dining",
  "Shopping",
  "Subscriptions",
  "EMI/Loan",
  "Healthcare",
  "Entertainment",
  "Travel",
  "General",
  "Uncategorized",
];

export async function extractTransactionsFromPdf(buffer: Buffer): Promise<ParsedStatementTransaction[]> {
  if (!PdfParseConstructor) throw new Error("PDFParseConstructor is undefined");
  const parser = new PdfParseConstructor({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy?.();

  console.log("[PDF PARSER] Extracted text from PDF:");
  console.log(parsed.text);

  let transactions = parseTextIntoTransactions(parsed.text);

  if (transactions.length === 0 && parsed.text.trim().length === 0) {
    console.log("[PDF PARSER] No transactions found in direct text. Trying OCR fallback...");
    const ocrText = await extractTextWithOcr(buffer);
    console.log("[PDF PARSER] Extracted text from OCR:");
    console.log(ocrText);
    transactions = parseTextIntoTransactions(ocrText);
  }

  return transactions;
}

function parseTextIntoTransactions(text: string): ParsedStatementTransaction[] {
  const normalizedText = text.replace(/(\S)\s+(?=\d{4}-\d{2}-\d{2}\b)/g, "$1\n");
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions: ParsedStatementTransaction[] = [];
  const defaultYear = findDefaultYear(text);
  const simulatedTransactions = parseSimulatedStatementTransactions(lines);
  if (simulatedTransactions.length > 0) {
    return simulatedTransactions;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(LINE_REGEX);

    if (match) {
      const [, dateRaw, rawDescription, rawAmount] = match;
      const parsedParts = splitDescriptionAndCategory(rawDescription);
      const maybeTransaction = buildTransaction(
        dateRaw,
        parsedParts.description,
        rawAmount,
        defaultYear,
        parsedParts.category
      );
      if (maybeTransaction) {
        transactions.push(maybeTransaction);
      }
      continue;
    }

    const startMatch = line.match(ENTRY_START_REGEX);
    if (startMatch) {
      const [, dateRaw, remainder] = startMatch;
      let description = normalizeDescription(remainder);

      let lookahead = index + 1;
      while (lookahead < lines.length) {
        const nextLine = lines[lookahead].trim();
        if (!nextLine) {
          lookahead += 1;
          continue;
        }

        const amountCandidate = pickAmountFromLine(nextLine);
        if (amountCandidate) {
          const parsedParts = splitDescriptionAndCategory(description);
          const maybeTransaction = buildTransaction(
            dateRaw,
            parsedParts.description,
            amountCandidate,
            defaultYear,
            parsedParts.category
          );
          if (maybeTransaction) {
            transactions.push(maybeTransaction);
            index = lookahead;
          }
          break;
        }

        if (ENTRY_START_REGEX.test(nextLine)) {
          break;
        }

        description = mergeDescription(description, normalizeDescription(nextLine));
        lookahead += 1;
      }
      continue;
    }

    const nameDateMatch = line.match(DATE_NAME_START_REGEX);
    if (nameDateMatch) {
      const [, day, month, yearMaybe, remainder] = nameDateMatch;
      const dateRaw = [day, month, yearMaybe].filter(Boolean).join(" ");
      let description = normalizeDescription(remainder);
      let lookahead = index + 1;
      while (lookahead < lines.length) {
        const nextLine = lines[lookahead].trim();
        if (!nextLine) {
          lookahead += 1;
          continue;
        }
        const amountCandidate = pickAmountFromLine(nextLine);
        if (amountCandidate) {
          const parsedParts = splitDescriptionAndCategory(description);
          const maybeTransaction = buildTransaction(
            dateRaw,
            parsedParts.description,
            amountCandidate,
            defaultYear,
            parsedParts.category
          );
          if (maybeTransaction) {
            transactions.push(maybeTransaction);
            index = lookahead;
          }
          break;
        }
        if (DATE_NAME_START_REGEX.test(nextLine) || ENTRY_START_REGEX.test(nextLine)) {
          break;
        }
        description = mergeDescription(description, normalizeDescription(nextLine));
        lookahead += 1;
      }
      continue;
    }

    const nameDateEndMatch = line.match(DATE_NAME_END_REGEX);
    if (nameDateEndMatch) {
      const [, rawDescription, day, month, yearMaybe] = nameDateEndMatch;
      const dateRaw = [day, month, yearMaybe].filter(Boolean).join(" ");
      const parsedParts = splitDescriptionAndCategory(rawDescription);
      const description = parsedParts.description;
      const amountCandidate = pickAmountFromLine(line);
      if (amountCandidate) {
        const maybeTransaction = buildTransaction(
          dateRaw,
          description,
          amountCandidate,
          defaultYear,
          parsedParts.category
        );
        if (maybeTransaction) {
          transactions.push(maybeTransaction);
        }
      }
    }
  }

  if (transactions.length === 0) {
    return parseColumnarTransactions(lines, defaultYear);
  }

  return transactions;
}

function parseSimulatedStatementTransactions(lines: string[]): ParsedStatementTransaction[] {
  const transactions: ParsedStatementTransaction[] = [];
  const now = new Date();
  const aliasValues = lines
    .map((line) => line.match(MONTH_ALIAS_HEADER_REGEX))
    .filter(Boolean)
    .map((match) => Number(match?.[2]))
    .filter((value) => !Number.isNaN(value));
  const maxAlias = aliasValues.length > 0 ? Math.max(...aliasValues) : 1;
  // Map the highest alias year to the previous completed calendar year.
  // Example in 2026: Y1/Y2 becomes 2024/2025, not 2025/2026.
  const aliasBaseYear = now.getUTCFullYear() - maxAlias - 1;
  let currentMonthIndex: number | null = null;
  let currentYearAlias: number | null = null;

  for (const line of lines) {
    if (
      /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) ||
      /^Date Description Category Amount/i.test(line) ||
      /simulated bank statement|synthetic, realistic test data/i.test(line) ||
      /^Location:/i.test(line)
    ) {
      continue;
    }

    const headerMatch = line.match(MONTH_ALIAS_HEADER_REGEX);
    if (headerMatch) {
      currentMonthIndex = monthNameToIndex(headerMatch[1]);
      currentYearAlias = Number(headerMatch[2]);
      continue;
    }

    const explicitMonthMatch = line.match(SIMULATED_ROW_WITH_MONTH_REGEX);
    if (explicitMonthMatch) {
      const [, monthRaw, dayRaw, description, category, amountRaw] = explicitMonthMatch;
      const monthIndex = monthNameToIndex(monthRaw);
      const yearAlias = currentYearAlias ?? 1;
      if (monthIndex === null) continue;
      const year = aliasBaseYear + yearAlias;
      const maybeTransaction = buildTransaction(
        `${year}-${String(monthIndex + 1).padStart(2, "0")}-${dayRaw}`,
        description,
        amountRaw,
        year,
        category,
      );
      if (maybeTransaction) {
        transactions.push(maybeTransaction);
      }
      currentMonthIndex = monthIndex;
      continue;
    }

    const dayOnlyMatch = line.match(SIMULATED_ROW_DAY_ONLY_REGEX);
    if (dayOnlyMatch && currentMonthIndex !== null && currentYearAlias !== null) {
      const [, dayRaw, description, category, amountRaw] = dayOnlyMatch;
      const year = aliasBaseYear + currentYearAlias;
      const maybeTransaction = buildTransaction(
        `${year}-${String(currentMonthIndex + 1).padStart(2, "0")}-${dayRaw}`,
        description,
        amountRaw,
        year,
        category,
      );
      if (maybeTransaction) {
        transactions.push(maybeTransaction);
      }
    }
  }

  return transactions;
}

function buildTransaction(
  dateRaw: string,
  rawDescription: string,
  rawAmount: string,
  defaultYear?: number,
  categoryOverride?: string,
  typeOverride?: "income" | "expense"
) {
  const normalizedAmount = Number(rawAmount.replace(/[,$\s]/g, ""));
  if (Number.isNaN(normalizedAmount)) return null;
  const description = normalizeDescription(rawDescription);
  if (!description || description.toLowerCase().startsWith("total")) return null;

  const transactionDate = normalizeDate(dateRaw, defaultYear);
  const type: "income" | "expense" =
    typeOverride ?? inferTransactionType(rawAmount, description, normalizedAmount);
  const amount = Math.abs(normalizedAmount);
  const category = categoryOverride ?? inferCategory(description, type);

  return {
    id: randomUUID(),
    date: transactionDate,
    description,
    category,
    amount,
    type,
  };
}

function normalizeDate(date: string, defaultYear?: number): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T12:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const nameMatch = date.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?/);
  if (nameMatch) {
    const [, dayRaw, monthRaw, yearRaw] = nameMatch;
    const month = monthNameToIndex(monthRaw);
    const year = yearRaw ? normalizeYear(yearRaw) : defaultYear ?? new Date().getFullYear();
    if (month !== null) {
      const parsed = new Date(Date.UTC(year, month, Number(dayRaw), 12));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  const numericMatch = date.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (numericMatch) {
    const [, aRaw, bRaw, yearRaw] = numericMatch;
    const a = Number(aRaw);
    const b = Number(bRaw);
    let month = a;
    let day = b;
    if (a > 12 && b <= 12) {
      // interpret as DD/MM when first number cannot be month
      day = a;
      month = b;
    }
    const year = yearRaw ? normalizeYear(yearRaw) : defaultYear ?? new Date().getFullYear();
    const parsed = new Date(Date.UTC(year, month - 1, day, 12));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function normalizeDescription(description: string): string {
  const cleaned = description.replace(/\s{2,}/g, " ").trim();
  if (!cleaned) return cleaned;
  const words = cleaned.split(" ");
  const deduped: string[] = [];
  for (const word of words) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.toLowerCase() === word.toLowerCase()) {
      continue;
    }
    deduped.push(word);
  }
  return deduped.join(" ").trim();
}

function mergeDescription(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  const currentWords = current.split(" ");
  const nextWords = next.split(" ");
  const lastCurrent = currentWords[currentWords.length - 1]?.toLowerCase();
  const firstNext = nextWords[0]?.toLowerCase();
  if (lastCurrent && firstNext && lastCurrent === firstNext) {
    nextWords.shift();
  }
  return normalizeDescription(`${current} ${nextWords.join(" ")}`);
}

function splitDescriptionAndCategory(raw: string): { description: string; category?: string } {
  const normalized = normalizeDescription(raw);
  const normalizedLower = normalized.toLowerCase();
  const match = knownCategoryLabels.find(
    (label) =>
      normalizedLower === label.toLowerCase() ||
      normalizedLower.endsWith(` ${label.toLowerCase()}`)
  );
  if (!match) {
    return { description: normalized };
  }
  const description = normalized.replace(new RegExp(`\\s*${match}$`, "i"), "").trim();
  return { description: description || normalized, category: match };
}

function inferTransactionType(
  rawAmount: string,
  description: string,
  normalizedAmount: number
): "income" | "expense" {
  if (normalizedAmount < 0 || /\(/.test(rawAmount)) {
    return "expense";
  }

  const normalized = description.toLowerCase();
  if (categoryKeywords.income.some((keyword) => normalized.includes(keyword))) {
    return "income";
  }

  return "expense";
}

function inferTypeFromSection(section: string): "income" | "expense" | undefined {
  const normalized = section.toLowerCase();
  if (!normalized) return undefined;
  if (/deposit|credit/.test(normalized)) return "income";
  if (/withdrawal|debit|purchase|check/.test(normalized)) return "expense";
  return undefined;
}

function inferCategory(description: string, type: "income" | "expense"): string {
  const normalized = description.toLowerCase();
  if (type === "income") {
    return "Income";
  }

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      if (category === "emi_loan") return "EMI/Loan";
      if (category === "rent") return "Rent/Housing";
      return capitalize(category);
    }
  }

  return "General";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function findDefaultYear(text: string): number | undefined {
  const matches = text.match(/\b(19|20)\d{2}\b/g);
  if (!matches || matches.length === 0) return undefined;
  return Number(matches[matches.length - 1]);
}

function normalizeYear(year: string): number {
  if (year.length === 2) {
    const asNum = Number(year);
    return asNum >= 70 ? 1900 + asNum : 2000 + asNum;
  }
  return Number(year);
}

function monthNameToIndex(name: string): number | null {
  const month = name.toLowerCase();
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const index = months.findIndex((value) => value.startsWith(month));
  return index === -1 ? null : index;
}

function pickAmountFromLine(line: string): string | null {
  if (/balance|total/i.test(line)) return null;
  const singleMatch = line.match(AMOUNT_ONLY_REGEX);
  if (singleMatch) return singleMatch[1];
  const matches = line.match(AMOUNT_REGEX);
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const parsed = matches
    .map((value) => ({ raw: value, num: Number(value.replace(/[,$\s]/g, "")) }))
    .filter((entry) => !Number.isNaN(entry.num));
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => Math.abs(a.num) - Math.abs(b.num));
  return parsed[0].raw;
}

function parseColumnarTransactions(lines: string[], defaultYear?: number): ParsedStatementTransaction[] {
  const transactions: ParsedStatementTransaction[] = [];
  let currentSection = "";
  let pendingDescription: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (SECTION_HEADERS.some((header) => lower.includes(header))) {
      currentSection = SECTION_HEADERS.find((header) => lower.includes(header)) ?? currentSection;
      pendingDescription = [];
      continue;
    }

    if (/total|ending balance|beginning balance/i.test(line)) {
      pendingDescription = [];
      continue;
    }

    const dateMatch = line.match(DATE_TOKEN_REGEX);
    const amountCandidate = pickAmountFromLine(line);

    if (dateMatch && amountCandidate) {
      const dateRaw = dateMatch[0];
      let description = line
        .replace(dateRaw, "")
        .replace(amountCandidate, "")
        .replace(/[\$,+]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (currentSection.includes("checks paid")) {
        const tokens = line.split(/\s+/);
        const checkNumber = tokens[1] && /^\d+$/.test(tokens[1]) ? tokens[1] : "";
        if (checkNumber) {
          description = `Check ${checkNumber}`;
        }
      }

      if (!description && pendingDescription.length > 0) {
        description = pendingDescription.join(" ");
      }
      if (!description && currentSection) {
        description = currentSection.replace(/\b\w/g, (c) => c.toUpperCase());
      }
      const maybeTransaction = buildTransaction(
        dateRaw,
        description,
        amountCandidate,
        defaultYear,
        undefined,
        inferTypeFromSection(currentSection)
      );
      if (maybeTransaction) {
        transactions.push(maybeTransaction);
      }
      pendingDescription = [];
      continue;
    }

    if (!amountCandidate && !dateMatch) {
      pendingDescription.push(line);
      if (pendingDescription.length > 3) {
        pendingDescription.shift();
      }
    }
  }

  return transactions;
}

async function extractTextWithOcr(buffer: Buffer): Promise<string> {
  // Load pdfjs-dist from the same dependency tree as pdf-parse to keep versions aligned
  const pdfParsePath = require.resolve("pdf-parse");
  const pdfjsPath = require.resolve("pdfjs-dist/legacy/build/pdf.mjs", {
    paths: [path.dirname(pdfParsePath)],
  });
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs", {
    paths: [path.dirname(pdfParsePath)],
  });
  const pdfjsModule = await import(pathToFileURL(pdfjsPath).toString());
  const pdfjsLib = (pdfjsModule as any).default ?? pdfjsModule;
  if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();
  }
  const tesseractModule = await tesseractPromise;
  const recognize =
    (tesseractModule as any).recognize ?? (tesseractModule as any).default?.recognize;
  if (typeof recognize !== "function") {
    throw new Error("Unable to initialize Tesseract recognize.");
  }

  // Load PDF with pdfjs-dist
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const textChunks: string[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    // Render PDF page to canvas
    await page.render({ canvasContext: context, viewport }).promise;

    // Convert canvas to image buffer
    const imgBuffer = canvas.toBuffer();

    // OCR the image buffer
    const result = await recognize(imgBuffer, "eng");
    textChunks.push(result?.data?.text ?? "");
  }
  return textChunks.join("\n");
}

class NodeCanvasFactory {}
