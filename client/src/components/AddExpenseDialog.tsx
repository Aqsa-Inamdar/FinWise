import { useState } from "react";
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
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

const expenseCategories = [
  { value: "rent", label: "Rent/Housing" },
  { value: "food", label: "Food/Groceries" },
  { value: "transportation", label: "Transportation" },
  { value: "entertainment", label: "Entertainment" },
  { value: "utilities", label: "Utilities" },
  { value: "healthcare", label: "Healthcare" },
  { value: "shopping", label: "Shopping" },
  { value: "other", label: "Other" },
];

const expenseFormSchema = z.object({
  amount: z.string().min(1, "Amount is required").refine(
    (val) => !isNaN(Number(val)) && Number(val) > 0,
    "Amount must be a positive number"
  ),
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required").max(200, "Description is too long"),
  date: z.string().min(1, "Date is required"),
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export function AddExpenseDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      amount: "",
      category: "",
      description: "",
      date: new Date().toISOString().split('T')[0],
    },
  });

  const onSubmit = async (data: ExpenseFormValues) => {
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: data.amount,
          category: data.category,
          description: data.description,
          date: new Date(data.date),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add expense");
      }

      toast({
        title: "Expense added",
        description: `Successfully added expense of $${data.amount}`,
      });

      form.reset();
      setOpen(false);
      
      // Trigger a page reload to update the data
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add expense. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-expense" aria-label="Add new expense">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]" aria-describedby="expense-dialog-description">
        <DialogHeader>
          <DialogTitle id="expense-dialog-title">Add New Expense</DialogTitle>
          <DialogDescription id="expense-dialog-description">
            Track your spending by adding a new expense. All fields are required.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="expense-amount">
                    Amount <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="expense-amount"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      data-testid="input-expense-amount"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.amount}
                      aria-describedby={form.formState.errors.amount ? "amount-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>Enter the amount spent</FormDescription>
                  <FormMessage id="amount-error" role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="expense-category">
                    Category <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger
                        id="expense-category"
                        data-testid="select-expense-category"
                        aria-required="true"
                        aria-invalid={!!form.formState.errors.category}
                        aria-describedby={form.formState.errors.category ? "category-error" : undefined}
                      >
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
                  <FormDescription>Choose the expense category</FormDescription>
                  <FormMessage id="category-error" role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="expense-description">
                    Description <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="expense-description"
                      placeholder="e.g., Monthly rent payment"
                      {...field}
                      data-testid="input-expense-description"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.description}
                      aria-describedby={form.formState.errors.description ? "description-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>Brief description of the expense</FormDescription>
                  <FormMessage id="description-error" role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="expense-date">
                    Date <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="expense-date"
                      type="date"
                      {...field}
                      data-testid="input-expense-date"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.date}
                      aria-describedby={form.formState.errors.date ? "date-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>When did this expense occur</FormDescription>
                  <FormMessage id="date-error" role="alert" />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                data-testid="button-cancel-expense"
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="button-submit-expense">
                Add Expense
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
