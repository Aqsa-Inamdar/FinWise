import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, Trash } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { getAuthHeader, queryClient } from "@/lib/queryClient";
import Tesseract from "tesseract.js";

const categoryKeywords: Record<string, string[]> = {
  rent: ["rent", "mortgage", "lease", "apartment", "housing"],
  food: ["restaurant", "cafe", "coffee", "food", "grocer", "dining", "meal", "bakery"],
  transportation: ["uber", "lyft", "taxi", "gas", "transport", "bus", "train", "flight", "cab"],
  entertainment: ["movie", "cinema", "concert", "ticket", "game", "entertainment"],
  utilities: ["utility", "electric", "water", "internet", "wifi", "power", "gas bill"],
  healthcare: ["clinic", "pharmacy", "doctor", "hospital", "medical", "dentist"],
  shopping: ["store", "market", "shop", "retail", "mall", "purchase"],
  emi_loan: ["emi", "loan", "mortgage payment", "installment"],
};

const toIsoDate = (value: Date) => {
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return adjusted.toISOString().split("T")[0];
};

const normalizeAmount = (raw: string) => {
  const numeric = parseFloat(raw.replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(numeric) && Math.abs(numeric) >= 1) {
    return Math.abs(numeric).toFixed(2);
  }
  return undefined;
};

const pickBestAmount = (candidates: Array<{ raw: string; weight: number }>) => {
  const normalized = candidates
    .map((candidate) => {
      const normalizedValue = normalizeAmount(candidate.raw);
      return {
        ...candidate,
        normalized: normalizedValue,
        numeric: normalizedValue ? parseFloat(normalizedValue) : undefined,
      };
    })
    .filter((candidate) => candidate.normalized !== undefined && candidate.numeric !== undefined) as Array<{
      raw: string;
      normalized: string;
      numeric: number;
      weight: number;
    }>;

  if (!normalized.length) return undefined;

  return normalized
    .sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }

      const aHasDecimal = /[.,]/.test(a.raw);
      const bHasDecimal = /[.,]/.test(b.raw);

      if (aHasDecimal !== bHasDecimal) {
        return aHasDecimal ? -1 : 1;
      }

      return b.numeric - a.numeric;
    })[0].normalized;
};

const parseReceiptDetails = (text: string) => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lower = text.toLowerCase();

  const importantKeywords = ["total", "amount due", "balance due", "grand total", "receipt total", "amount"];
  const supportingKeywords = ["subtotal", "tax", "due"];
  const paymentKeywords = ["tend", "change", "cash", "visa", "amex", "mastercard", "disc", "paid", "receive"];

  const amountRegexGlobal = /[$€£]?\s*-?\d{1,3}(?:[,\d]{3})*(?:\.\d{2})?|-?\d+(?:\.\d{2})?/g;

  const weightedCandidates: Array<{ raw: string; weight: number }> = [];

  lines.forEach((line, index) => {
    const normalizedLine = line.toLowerCase();
    const matches = line.match(amountRegexGlobal) || [];

    let weight = 1;
    const containsImportant = importantKeywords.some((keyword) => normalizedLine.includes(keyword));
    const containsSupporting = supportingKeywords.some((keyword) => normalizedLine.includes(keyword));
    const containsPayment = paymentKeywords.some((keyword) => normalizedLine.includes(keyword));

    if (containsImportant) {
      weight = 5;
    } else if (containsSupporting) {
      weight = 3;
    }

    if (containsPayment) {
      weight -= 4; // de-emphasize payment method totals (e.g., TEND 100.00)
    }

    matches.forEach((raw) => {
      const digitCount = raw.replace(/[^\d]/g, "").length;
      const adjustedWeight = digitCount >= 7 ? weight - 2 : weight;
      weightedCandidates.push({ raw, weight: adjustedWeight });
    });

    // Some receipts place the numeric total on the next line (e.g., "TOTAL" newline "100.00")
    if (!matches.length && containsImportant) {
      for (let offset = 1; offset <= 2; offset++) {
        const neighborLine = lines[index + offset];
        if (!neighborLine) break;
        const neighborMatches = neighborLine.match(amountRegexGlobal);
        if (neighborMatches?.length) {
          neighborMatches.forEach((raw) => {
            const digitCount = raw.replace(/[^\d]/g, "").length;
            const adjustedWeight = digitCount >= 7 ? weight - 2 : weight;
            weightedCandidates.push({ raw, weight: Math.max(adjustedWeight - 1, 1) });
          });
          break;
        }
      }
    }
  });

  const currencyAmountCandidates = (text.match(/[$€£]\s*-?\d{1,3}(?:[,\d]{3})*(?:\.\d{2})?/g) ?? []).map((raw) => ({
    raw,
    weight: 2,
  }));

  const numericCandidates = (text.match(/\b-?\d{1,3}(?:,\d{3})*(?:\.\d{2})\b/g) ?? []).map((raw) => ({
    raw,
    weight: 1,
  }));

  const integerCandidates =
    text
      .match(/\b-?\d{2,6}\b/g)
      ?.filter((candidate) => {
        const numeric = Math.abs(parseInt(candidate.replace(/[^0-9-]/g, ""), 10));
        return Number.isFinite(numeric) && numeric >= 5 && numeric <= 100000 && (numeric < 1900 || numeric > 2100);
      })
      .map((raw) => ({ raw, weight: 0.5 })) ?? [];

  const amountValue =
    pickBestAmount(weightedCandidates) ??
    pickBestAmount(currencyAmountCandidates) ??
    pickBestAmount(numericCandidates) ??
    pickBestAmount(integerCandidates);

  const slashDateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  const monthNameMatch = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{2,4}/i
  );
  let dateValue: string | undefined;

  const tryParseDate = (raw: string | undefined) => {
    if (!raw) return undefined;
    const normalized = raw.replace(/-/g, "/");
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return toIsoDate(parsed);
    }
    return undefined;
  };

  dateValue = tryParseDate(slashDateMatch?.[1]) ?? tryParseDate(monthNameMatch?.[0]);

  let categoryValue: string | undefined;
  for (const [value, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      categoryValue = value;
      break;
    }
  }

  let descriptionValue: string | undefined;
  const vendorLine = lines.find(
    (line) => line.length > 3 && !/receipt|invoice|total|amount|qty|item|description/i.test(line)
  );
  if (vendorLine) {
    descriptionValue = `Purchase at ${vendorLine}`;
  } else if (lines.length) {
    descriptionValue = `Expense from ${lines[0]}`;
  }

  return {
    amount: amountValue,
    date: dateValue,
    category: categoryValue,
    description: descriptionValue,
  };
};

// Expense categories
const expenseCategories = [
  { value: "rent", label: "Rent/Housing" },
  { value: "food", label: "Food/Groceries" },
  { value: "transportation", label: "Transportation" },
  { value: "entertainment", label: "Entertainment" },
  { value: "utilities", label: "Utilities" },
  { value: "internet", label: "Internet" },
  { value: "phone", label: "Phone" },
  { value: "shopping", label: "Shopping" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "emi_loan", label: "EMI/Loan" },
  { value: "healthcare", label: "Healthcare" },
  { value: "other", label: "Other" },
];

// Schema (OCR-ready)
const expenseFormSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required").max(200),
  date: z.string().min(1, "Date is required"),
  receipt: z.any().optional(),
  ocrText: z.string().optional(), // OCR placeholder
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

const getDefaultExpenseValues = (): ExpenseFormValues => ({
  amount: "",
  category: "",
  description: "",
  date: new Date().toISOString().split("T")[0],
  receipt: undefined,
  ocrText: "",
});

export function AddExpenseDialog() {
  const [open, setOpen] = useState(false);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState("No receipt uploaded");
  const [ocrStatus, setOcrStatus] = useState("Waiting for receipt image");
  const [ocrText, setOcrText] = useState("");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputId = useId();
  const cameraInputId = useId();

  const { toast } = useToast();

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: getDefaultExpenseValues(),
  });

  const resetFormState = () => {
    form.reset(getDefaultExpenseValues(), { keepDefaultValues: false });
    setReceiptFile(null);
    setReceiptPreview(null);
    setReceiptStatus("No receipt uploaded");
    setOcrStatus("Waiting for receipt image");
    setOcrText("");
    setOcrError(null);
  };

  const runReceiptOCR = async (file: File) => {
    setIsOcrRunning(true);
    setOcrStatus("Analyzing receipt…");
    setOcrError(null);
    try {
      const result = await Tesseract.recognize(file, "eng", {
        logger: (message) => {
          if (message.progress !== undefined) {
            const percent = Math.round(message.progress * 100);
            setOcrStatus(`${message.status} (${percent}%)`);
          } else {
            setOcrStatus(message.status);
          }
        },
      });

      const cleanedText = result.data.text?.trim() ?? "";
      setOcrText(cleanedText);
      form.setValue("ocrText", cleanedText);
      console.info("[OCR] Receipt contents:", cleanedText);

      if (!cleanedText) {
        setOcrError("No readable text detected. Try retaking the photo.");
      } else {
        setOcrStatus("Receipt text captured");
        const parsed = parseReceiptDetails(cleanedText);

        if (parsed.amount) {
          form.setValue("amount", parsed.amount, { shouldDirty: true });
        }

        if (parsed.category) {
          form.setValue("category", parsed.category, { shouldDirty: true });
        }

        if (parsed.description) {
          form.setValue("description", parsed.description, { shouldDirty: true });
        }

        if (parsed.date) {
          form.setValue("date", parsed.date, { shouldDirty: true });
        }
      }
    } catch (error) {
      console.error("[OCR] Failed to process receipt", error);
      setOcrError("Failed to read receipt. Please try again.");
      setOcrStatus("OCR failed");
    } finally {
      setIsOcrRunning(false);
    }
  };

  const mutation = useMutation({
    mutationFn: async (data: ExpenseFormValues) => {
      const { receipt, ocrText, ...rest } = data;
      const authHeader = await getAuthHeader();

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          ...rest,
          date: new Date(data.date),
          ocrText, // future backend field
        }),
      });

      if (!response.ok) throw new Error("Failed to add expense");
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });

      toast({
        title: "Expense added",
        description: `Successfully added $${variables.amount}`,
      });

      form.reset();
      setReceiptPreview(null);
      setReceiptFile(null);
      setOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add expense.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ExpenseFormValues) => {
    data.receipt = receiptFile;
    mutation.mutate(data);
  };

  const handleReceiptChange = async (file: File | null) => {
    setReceiptFile(file);
    setReceiptPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
    setReceiptStatus(file ? `Receipt selected: ${file.name}` : "No receipt uploaded");

    if (!file) {
      setOcrStatus("Waiting for receipt image");
      setOcrText("");
      setOcrError(null);
      form.setValue("ocrText", "");
      return;
    }

    await runReceiptOCR(file);
  };

  const removeReceipt = () => {
    void handleReceiptChange(null);
    form.setValue("receipt", undefined);
  };

  useEffect(() => {
    return () => {
      if (receiptPreview) {
        URL.revokeObjectURL(receiptPreview);
      }
    };
  }, [receiptPreview]);

  useEffect(() => {
    if (!open) {
      resetFormState();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button aria-label="Add new expense">
          <Plus className="mr-2 h-4 w-4" />
          Add Expense
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Expense</DialogTitle>
          <DialogDescription>All fields are required.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* AMOUNT */}
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      inputMode="decimal"
                      required
                    />
                  </FormControl>
                  <FormDescription>Enter the amount spent</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* CATEGORY */}
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-required="true">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {expenseCategories.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>Choose expense category</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* DESCRIPTION */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Monthly rent payment" {...field} required />
                  </FormControl>
                  <FormDescription>Short description of the expense</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* DATE */}
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} required />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* RECEIPT UPLOAD + CAMERA + PREVIEW */}
            <FormField
              control={form.control}
              name="receipt"
              render={() => (
                <FormItem>
                  <FormLabel>Receipt (optional)</FormLabel>
                  <FormDescription>
                    Upload from device or take a photo. Supported formats: PNG or JPG.
                  </FormDescription>

                  {/* hidden file inputs */}
                  <input
                    type="file"
                    accept="image/*"
                    id={uploadInputId}
                    ref={uploadInputRef}
                    className="sr-only"
                    onChange={(e) => {
                      void handleReceiptChange(e.target.files?.[0] ?? null);
                    }}
                  />

                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    id={cameraInputId}
                    ref={cameraInputRef}
                    className="sr-only"
                    onChange={(e) => {
                      void handleReceiptChange(e.target.files?.[0] ?? null);
                    }}
                  />

                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      aria-controls={uploadInputId}
                    >
                      Upload from device
                    </Button>

                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      aria-controls={cameraInputId}
                    >
                      Use camera
                    </Button>
                  </div>

                  <p className="sr-only" role="status" aria-live="polite">
                    {receiptStatus}
                  </p>

                  {receiptPreview && (
                    <div className="mt-3 relative inline-block">
                      <img
                        src={receiptPreview}
                        className="max-h-40 rounded border"
                        alt="Receipt preview"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={removeReceipt}
                        aria-label="Remove receipt"
                      >
                        <Trash className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 space-y-2" aria-live="polite">
                    <p className="text-sm text-muted-foreground">
                      {isOcrRunning ? `${ocrStatus}` : ocrStatus}
                    </p>
                    {ocrError && (
                      <p className="text-sm text-destructive" role="alert">
                        {ocrError}
                      </p>
                    )}
                    {ocrText && (
                      <div className="rounded-md border bg-muted/20 p-3 text-sm">
                        <p className="font-medium">Extracted text preview</p>
                        <p className="mt-1 whitespace-pre-wrap">{ocrText}</p>
                      </div>
                    )}
                  </div>

                  <FormMessage />
                </FormItem>
              )}
            />

            {/* SUBMIT */}
            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add Expense</Button>
            </div>

          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
