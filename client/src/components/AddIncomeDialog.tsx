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
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { getAuthHeader, queryClient } from "@/lib/queryClient";

const incomeFormSchema = z.object({
  amount: z.string().min(1, "Amount is required").refine(
    (val) => !isNaN(Number(val)) && Number(val) > 0,
    "Amount must be a positive number"
  ),
  source: z.string().min(1, "Source is required").max(100, "Source is too long"),
  description: z.string().min(1, "Description is required").max(200, "Description is too long"),
  date: z.string().min(1, "Date is required"),
});

type IncomeFormValues = z.infer<typeof incomeFormSchema>;

export function AddIncomeDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<IncomeFormValues>({
    resolver: zodResolver(incomeFormSchema),
    defaultValues: {
      amount: "",
      source: "",
      description: "",
      date: new Date().toISOString().split('T')[0],
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: IncomeFormValues) => {
      const authHeader = await getAuthHeader();
      const response = await fetch("/api/income", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          amount: data.amount,
          source: data.source,
          description: data.description,
          date: new Date(data.date),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add income");
      }

      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/income"] });
      toast({
        title: "Income added",
        description: `Successfully added income of $${variables.amount}`,
      });
      form.reset();
      setOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add income. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: IncomeFormValues) => {
    mutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-add-income" aria-label="Add new income">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add Income
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Income</DialogTitle>
          <DialogDescription>
            Record your income sources. All fields are required.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="income-amount">
                    Amount <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="income-amount"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...field}
                      data-testid="input-income-amount"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.amount}
                      aria-describedby={form.formState.errors.amount ? "income-amount-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>Enter the income amount</FormDescription>
                  <FormMessage id="income-amount-error" role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="income-source">
                    Source <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="income-source"
                      placeholder="e.g., Salary, Freelance, Investment"
                      {...field}
                      data-testid="input-income-source"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.source}
                      aria-describedby={form.formState.errors.source ? "source-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>Where did this income come from</FormDescription>
                  <FormMessage id="source-error" role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="income-description">
                    Description <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="income-description"
                      placeholder="e.g., Monthly salary payment"
                      {...field}
                      data-testid="input-income-description"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.description}
                      aria-describedby={form.formState.errors.description ? "income-description-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>Brief description of the income</FormDescription>
                  <FormMessage id="income-description-error" role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="income-date">
                    Date <span className="text-destructive" aria-label="required">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="income-date"
                      type="date"
                      {...field}
                      data-testid="input-income-date"
                      aria-required="true"
                      aria-invalid={!!form.formState.errors.date}
                      aria-describedby={form.formState.errors.date ? "income-date-error" : undefined}
                    />
                  </FormControl>
                  <FormDescription>When did you receive this income</FormDescription>
                  <FormMessage id="income-date-error" role="alert" />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                data-testid="button-cancel-income"
              >
                Cancel
              </Button>
              <Button type="submit" data-testid="button-submit-income">
                Add Income
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
