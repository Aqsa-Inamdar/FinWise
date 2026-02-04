import { useMemo, useState, useEffect } from "react";
import FirestoreTestButton from "@/components/FirestoreTestButton";
import { useQueryClient } from "@tanstack/react-query";
import { useFirestoreTransactions } from "@/hooks/useFirestoreTransactions";
import { getAuthHeader } from "@/lib/queryClient";
import { DateRange } from "react-day-picker";
import { format, endOfDay, startOfDay } from "date-fns";
import { CalendarIcon, ArrowUpDown, UploadCloud } from "lucide-react";
import type { Expense, Income } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";


type Transaction = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: "income" | "expense";
};

type ParsedTransactionDraft = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: string;
  type: "income" | "expense";
};

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pageSize = 10;


export default function Transactions() {
  const queryClient = useQueryClient();
  const { transactions, loading: firestoreLoading, error } = useFirestoreTransactions();

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [sortKey, setSortKey] = useState<"date" | "amount">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // transactions now comes from Firestore

  const categoryOptions = useMemo(() => {
    const unique = new Set(transactions.map((txn) => txn.category));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const yearOptions = useMemo(() => {
    const unique = new Set<string>();
    transactions.forEach((txn) => {
      unique.add(new Date(txn.date).getFullYear().toString());
    });
    return Array.from(unique).sort();
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      const txnDate = new Date(txn.date);
      if (dateRange?.from && txnDate < startOfDay(dateRange.from)) return false;
      if (dateRange?.to && txnDate > endOfDay(dateRange.to)) return false;
      if (monthFilter !== "all" && txnDate.getMonth().toString() !== monthFilter) return false;
      if (yearFilter !== "all" && txnDate.getFullYear().toString() !== yearFilter) return false;
      if (categoryFilter !== "all" && txn.category !== categoryFilter) return false;
      if (typeFilter !== "all" && txn.type !== typeFilter) return false;
      if (searchQuery) {
        const normalized = `${txn.description} ${txn.category}`.toLowerCase();
        if (!normalized.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [transactions, dateRange, monthFilter, yearFilter, categoryFilter, typeFilter, searchQuery]);

  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      let comparison = 0;
      if (sortKey === "date") {
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
      } else {
        comparison = a.amount - b.amount;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredTransactions, sortKey, sortDirection]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, categoryFilter, monthFilter, yearFilter, typeFilter, dateRange]);

  const totalPages = Math.max(1, Math.ceil(sortedTransactions.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedTransactions.slice(startIndex, startIndex + pageSize);
  }, [sortedTransactions, currentPage]);

  const handleSort = (key: "date" | "amount") => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const handleReset = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setTypeFilter("all");
    setMonthFilter("all");
    setYearFilter("all");
    setDateRange(undefined);
    setSortKey("date");
    setSortDirection("desc");
    setPage(1);
  };

  const handleImportedTransactions = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
    queryClient.invalidateQueries({ queryKey: ["/api/income"] });
  };

  const loading = firestoreLoading;

  return (
    <div className="space-y-6" role="region" aria-labelledby="transactions-title">
      <FirestoreTestButton />
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="transactions-title" className="text-3xl font-light tracking-tight">
            Transactions
          </h1>
          <p className="text-sm text-muted-foreground">
            View and manage all your logged financial activity
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="Search description or category..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full sm:w-64"
            aria-label="Search transactions"
          />
          <StatementImportDialog onImportComplete={handleImportedTransactions} />
        </div>
      </div>

      <section
        aria-label="Transaction filters"
        className="rounded-lg border bg-card p-4 shadow-sm space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Date range</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={`w-full justify-start text-left font-normal ${!dateRange ? "text-muted-foreground" : ""}`}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      `${format(dateRange.from, "LLL dd, y")} - ${format(dateRange.to, "LLL dd, y")}`
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Select range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={dateRange}
                  onSelect={setDateRange}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Month</span>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger aria-label="Filter by month">
                <SelectValue placeholder="All months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All months</SelectItem>
                {months.map((label, index) => (
                  <SelectItem key={label} value={index.toString()}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Year</span>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger aria-label="Filter by year">
                <SelectValue placeholder="All years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Category</span>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categoryOptions.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Type</span>
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as "all" | "income" | "expense")}>
              <SelectTrigger aria-label="Filter by transaction type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Actions</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleReset}>
                Reset filters
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  <button
                    type="button"
                    className="flex items-center gap-2 font-medium"
                    onClick={() => handleSort("date")}
                    aria-label="Sort by date"
                  >
                    Date
                    <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </TableHead>
                <TableHead scope="col">Description</TableHead>
                <TableHead scope="col">Category</TableHead>
                <TableHead scope="col">
                  <button
                    type="button"
                    className="flex items-center gap-2 font-medium"
                    onClick={() => handleSort("amount")}
                    aria-label="Sort by amount"
                  >
                    Amount
                    <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </TableHead>
                <TableHead scope="col">Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Loading transactions...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-destructive">
                    Error loading transactions: {error}
                  </TableCell>
                </TableRow>
              ) : paginatedTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No transactions match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTransactions.map((txn) => {
                  const amountLabel = `${txn.type === "income" ? "income" : "expense"}`;
                  const amountFormatted = new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: "USD",
                  }).format(txn.amount);
                  return (
                    <TableRow
                      key={txn.id}
                      tabIndex={0}
                      aria-label={`${amountFormatted} ${amountLabel} on ${format(new Date(txn.date), "MMM d, yyyy")} for ${txn.category}`}
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <TableCell>{format(new Date(txn.date), "MMM d, yyyy")}</TableCell>
                      <TableCell>{txn.description}</TableCell>
                      <TableCell>{txn.category}</TableCell>
                      <TableCell className={txn.type === "income" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        <span aria-hidden="true">{amountFormatted}</span>
                        <span className="sr-only">
                          {`${amountFormatted} ${txn.type === "income" ? "income" : "expense"} for ${txn.category}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            txn.type === "income"
                              ? "bg-green-600/10 text-green-700 dark:bg-green-500/20 dark:text-green-200"
                              : "bg-red-600/10 text-red-700 dark:bg-red-500/20 dark:text-red-200"
                          }`}
                        >
                          {txn.type === "income" ? "Income" : "Expense"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {paginatedTransactions.length > 0 && (
          <div className="border-t px-4 py-4">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setPage((prev) => Math.max(1, prev - 1));
                    }}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                  <PaginationItem key={pageNumber}>
                    <PaginationLink
                      href="#"
                      isActive={pageNumber === currentPage}
                      onClick={(event) => {
                        event.preventDefault();
                        setPage(pageNumber);
                      }}
                    >
                      {pageNumber}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      setPage((prev) => Math.min(totalPages, prev + 1));
                    }}
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </div>
  );
}

function StatementImportDialog({ onImportComplete }: { onImportComplete: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<ParsedTransactionDraft[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setDrafts([]);
    setError(null);
    setIsParsing(false);
    setIsSaving(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("statement", file);
      const authHeader = await getAuthHeader();
      const response = await fetch("/api/transactions/parse-pdf", {
        method: "POST",
        headers: authHeader,
        body: formData,
      });
      const contentType = response.headers.get("content-type");
      let result: any;
      if (contentType?.includes("application/json")) {
        result = await response.json();
        if (!response.ok) {
          throw new Error(result?.error ?? "Unable to parse PDF");
        }
      } else {
        const text = await response.text();
        if (!response.ok) {
          throw new Error(text || "Unable to parse PDF");
        }
        try {
          result = JSON.parse(text);
        } catch {
          throw new Error("Unexpected response from server. Please try again.");
        }
      }
      const parsedDrafts: ParsedTransactionDraft[] = (result.transactions ?? []).map((txn: any) => ({
        id: txn.id ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        date: txn.date ? txn.date.slice(0, 10) : "",
        description: txn.description ?? "",
        category: txn.category ?? "General",
        amount: txn.amount ? String(txn.amount) : "",
        type: txn.type === "income" ? "income" : "expense",
      }));
      setDrafts(parsedDrafts);
      if (!parsedDrafts.length) {
        setError("No transactions were detected in this statement.");
      }
    } catch (parseError: any) {
      setError(parseError?.message ?? "Failed to parse PDF");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  };

  const updateDraft = (id: string, patch: Partial<ParsedTransactionDraft>) => {
    setDrafts((previous) =>
      previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );
  };

  const handleSaveAll = async () => {
    if (!drafts.length) return;
    setIsSaving(true);
    setError(null);
    try {
      // Assume transactions are already written to Firestore by backend after PDF parse
      toast({
        title: "Transactions imported",
        description: `${drafts.length} transaction${drafts.length === 1 ? "" : "s"} saved to Firestore!`,
      });
      resetState();
      setOpen(false);
      onImportComplete();
    } catch (saveError: any) {
      setError(saveError?.message ?? "Failed to save transactions");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetState();
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto">
          <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
          Upload PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import statement</DialogTitle>
          <DialogDescription>
            Upload a bank or credit statement PDF to extract transactions automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="statement-upload" className="text-sm font-medium">
              Statement PDF
            </label>
            <Input
              id="statement-upload"
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              aria-describedby="statement-upload-hint"
            />
            <p id="statement-upload-hint" className="text-sm text-muted-foreground mt-1">
              Choose a PDF up to 10MB. Transactions will appear below for review.
            </p>
          </div>

          {isParsing && <p className="text-sm text-muted-foreground">Parsing statement…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {drafts.length > 0 && (
            <div className="rounded-md border">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Date</TableHead>
                      <TableHead scope="col">Description</TableHead>
                      <TableHead scope="col">Category</TableHead>
                      <TableHead scope="col">Amount</TableHead>
                      <TableHead scope="col">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((draft) => (
                      <TableRow key={draft.id}>
                        <TableCell>
                          <Input
                            type="date"
                            value={draft.date}
                            onChange={(event) => updateDraft(draft.id, { date: event.target.value })}
                            aria-label="Transaction date"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={draft.description}
                            onChange={(event) =>
                              updateDraft(draft.id, { description: event.target.value })
                            }
                            aria-label="Transaction description"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={draft.category}
                            onChange={(event) => updateDraft(draft.id, { category: event.target.value })}
                            aria-label="Transaction category"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={draft.amount}
                            onChange={(event) => updateDraft(draft.id, { amount: event.target.value })}
                            aria-label="Transaction amount"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={draft.type}
                            onValueChange={(value) =>
                              updateDraft(draft.id, { type: value as "income" | "expense" })
                            }
                          >
                            <SelectTrigger aria-label="Transaction type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="expense">Expense</SelectItem>
                              <SelectItem value="income">Income</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={resetState} disabled={isParsing || isSaving}>
            Clear
          </Button>
          <Button
            type="button"
            onClick={handleSaveAll}
            disabled={isSaving || drafts.length === 0}
            aria-live="polite"
          >
            {isSaving ? "Saving…" : `Save ${drafts.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
