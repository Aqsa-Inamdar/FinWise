import { useState } from "react";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
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
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const addGoalSchema = z.object({
  name: z.string().min(1, "Goal name is required"),
  targetAmount: z
    .string()
    .min(1, "Target amount is required")
    .refine((v) => Number(v) > 0, "Target amount must be positive"),
  deadline: z.string().min(1, "Deadline is required"),
  category: z.string().optional(),
  allocationOverride: z
    .string()
    .optional()
    .refine((v) => !v || Number(v) >= 0, "Allocated amount must be zero or positive"),
});

type AddGoalValues = z.infer<typeof addGoalSchema>;

const defaultValues: AddGoalValues = {
  name: "",
  targetAmount: "",
  deadline: "",
  category: "",
  allocationOverride: "",
};

export function AddGoalDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<AddGoalValues>({
    resolver: zodResolver(addGoalSchema),
    defaultValues,
  });

  const mutation = useMutation({
    mutationFn: async (values: AddGoalValues) => {
      const payload = {
        name: values.name,
        targetAmount: Number(values.targetAmount),
        // Backward compatibility for older backend validators; server ignores this now.
        currentAmount: 0,
        deadline: values.deadline,
        category: values.category?.trim() || null,
        allocationOverride:
          values.allocationOverride?.trim()
            ? Number(values.allocationOverride)
            : null,
      };
      const res = await apiRequest("POST", "/api/goals", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({
        title: "Goal added",
        description: "Your new goal has been created.",
      });
      form.reset(defaultValues);
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add goal",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: AddGoalValues) => {
    mutation.mutate(values);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) form.reset(defaultValues);
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="button-add-goal">
          <Plus className="mr-2 h-4 w-4" />
          Add Goal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Goal</DialogTitle>
          <DialogDescription>
            Current saved amount is auto-calculated from your transactions (income minus expenses).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="goal-name">Goal name</FormLabel>
                  <FormControl>
                    <Input id="goal-name" placeholder="e.g., Emergency Fund" aria-describedby="goal-name-help" {...field} />
                  </FormControl>
                  <FormDescription id="goal-name-help">Use a short, specific name so this goal is easy to identify later.</FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="goal-target">Target amount</FormLabel>
                  <FormControl>
                    <Input id="goal-target" type="number" step="0.01" min="0" placeholder="10000" aria-describedby="goal-target-help" {...field} />
                  </FormControl>
                  <FormDescription id="goal-target-help">Enter the full dollar amount you want to reach for this goal.</FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deadline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="goal-deadline">Deadline</FormLabel>
                  <FormControl>
                    <Input id="goal-deadline" type="date" aria-describedby="goal-deadline-help" {...field} />
                  </FormControl>
                  <FormDescription id="goal-deadline-help">Pick the date by which you want to complete this goal.</FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="goal-category">Category (optional)</FormLabel>
                  <FormControl>
                    <Input id="goal-category" placeholder="e.g., Travel, Home, Education" aria-describedby="goal-category-help" {...field} />
                  </FormControl>
                  <FormDescription id="goal-category-help">This helps group similar goals, but you can leave it blank.</FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="allocationOverride"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="goal-allocation">Savings allocated to this goal (optional)</FormLabel>
                  <FormControl>
                    <Input
                      id="goal-allocation"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Leave empty for automatic allocation"
                      aria-describedby="goal-allocation-help"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription id="goal-allocation-help">
                    If left blank, the app will allocate savings automatically by deadline priority.
                  </FormDescription>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save Goal"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
