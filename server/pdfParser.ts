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

const LINE_REGEX = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+?)\s+([+-]?\$?\d[\d,]*\.\d{2})$/;
const ENTRY_START_REGEX = /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+)/;
const DATE_NAME_START_REGEX = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?\s+(.+)/;
const DATE_NAME_END_REGEX = /^(.+?)\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/;
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
  groceries: ["grocery", "market", "mart", "superstore", "walmart", "aldi", "costco"],
  dining: ["cafe", "restaurant", "coffee", "diner", "eatery"],
  transport: ["uber", "lyft", "gas", "fuel", "shell", "chevron", "transport"],
  income: ["salary", "payroll", "deposit", "paycheck", "direct deposit"],
};

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
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions: ParsedStatementTransaction[] = [];
  const defaultYear = findDefaultYear(text);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(LINE_REGEX);

    if (match) {
      const [, dateRaw, rawDescription, rawAmount] = match;
      const maybeTransaction = buildTransaction(dateRaw, rawDescription, rawAmount, defaultYear);
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
          const maybeTransaction = buildTransaction(dateRaw, description, amountCandidate, defaultYear);
          if (maybeTransaction) {
            transactions.push(maybeTransaction);
            index = lookahead;
          }
          break;
        }

        if (ENTRY_START_REGEX.test(nextLine)) {
          break;
        }

        description += " " + normalizeDescription(nextLine);
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
          const maybeTransaction = buildTransaction(dateRaw, description, amountCandidate, defaultYear);
          if (maybeTransaction) {
            transactions.push(maybeTransaction);
            index = lookahead;
          }
          break;
        }
        if (DATE_NAME_START_REGEX.test(nextLine) || ENTRY_START_REGEX.test(nextLine)) {
          break;
        }
        description += " " + normalizeDescription(nextLine);
        lookahead += 1;
      }
      continue;
    }

    const nameDateEndMatch = line.match(DATE_NAME_END_REGEX);
    if (nameDateEndMatch) {
      const [, rawDescription, day, month, yearMaybe] = nameDateEndMatch;
      const dateRaw = [day, month, yearMaybe].filter(Boolean).join(" ");
      const description = normalizeDescription(rawDescription);
      const amountCandidate = pickAmountFromLine(line);
      if (amountCandidate) {
        const maybeTransaction = buildTransaction(dateRaw, description, amountCandidate, defaultYear);
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

function buildTransaction(
  dateRaw: string,
  rawDescription: string,
  rawAmount: string,
  defaultYear?: number
) {
  const normalizedAmount = Number(rawAmount.replace(/[,$\s]/g, ""));
  if (Number.isNaN(normalizedAmount)) return null;
  const description = normalizeDescription(rawDescription);
  if (!description || description.toLowerCase().startsWith("total")) return null;

  const transactionDate = normalizeDate(dateRaw, defaultYear);
  const type: "income" | "expense" = normalizedAmount >= 0 ? "income" : "expense";
  const amount = Math.abs(normalizedAmount);
  const category = inferCategory(description, type);

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
  const nameMatch = date.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?/);
  if (nameMatch) {
    const [, dayRaw, monthRaw, yearRaw] = nameMatch;
    const month = monthNameToIndex(monthRaw);
    const year = yearRaw ? normalizeYear(yearRaw) : defaultYear ?? new Date().getFullYear();
    if (month !== null) {
      const parsed = new Date(Date.UTC(year, month, Number(dayRaw)));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function normalizeDescription(description: string): string {
  return description.replace(/\s{2,}/g, " ").trim();
}

function inferCategory(description: string, type: "income" | "expense"): string {
  const normalized = description.toLowerCase();
  if (type === "income") {
    return "Income";
  }

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
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
      const maybeTransaction = buildTransaction(dateRaw, description, amountCandidate, defaultYear);
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
