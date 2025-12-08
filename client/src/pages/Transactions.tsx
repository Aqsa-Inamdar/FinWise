import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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

type Transaction = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
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
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: expenses = [], isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["/api/expenses"],
  });
  const { data: income = [], isLoading: incomeLoading } = useQuery<Income[]>({
    queryKey: ["/api/income"],
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [sortKey, setSortKey] = useState<"date" | "amount">("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const transactions: Transaction[] = useMemo(() => {
    const mappedExpenses: Transaction[] = expenses.map((expense) => ({
      id: `expense-${expense.id}`,
      date: expense.date ? new Date(expense.date).toISOString() : new Date().toISOString(),
      description: expense.description,
      category: expense.category,
      amount: Number(expense.amount),
      type: "expense",
    }));

    const mappedIncome: Transaction[] = income.map((item) => ({
      id: `income-${item.id}`,
      date: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
      description: item.description,
      category: item.source ?? "Income",
      amount: Number(item.amount),
      type: "income",
    }));

    return [...mappedExpenses, ...mappedIncome];
  }, [expenses, income]);

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

  const handleUploadPdf = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      toast({
        title: "Statement uploaded",
        description: `${file.name} ready for processing.`,
      });
      event.target.value = "";
    }
  };

  const loading = expensesLoading || incomeLoading;

  return (
    <div className="space-y-6" role="region" aria-labelledby="transactions-title">
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
          <div>
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              ref={fileInputRef}
              onChange={handleUploadPdf}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
              Upload PDF
            </Button>
          </div>
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
