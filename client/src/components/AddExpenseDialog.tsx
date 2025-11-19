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
import { Plus, Trash } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

// Expense categories
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

export function AddExpenseDialog() {
  const [open, setOpen] = useState(false);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const { toast } = useToast();

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      amount: "",
      category: "",
      description: "",
      date: new Date().toISOString().split("T")[0],
      receipt: undefined,
      ocrText: "",
    },
  });

  // 🔥 Placeholder for OCR future integration
  const performOCR = async (file: File) => {
    console.log("OCR will run here for:", file.name);
    return ""; // will return OCR text later
  };

  const mutation = useMutation({
    mutationFn: async (data: ExpenseFormValues) => {
      const { receipt, ocrText, ...rest } = data;

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  const onSubmit = async (data: ExpenseFormValues) => {
    if (receiptFile) {
      const ocrText = await performOCR(receiptFile);
      data.ocrText = ocrText;
    }

    data.receipt = receiptFile;
    mutation.mutate(data);
  };

  const removeReceipt = () => {
    setReceiptPreview(null);
    setReceiptFile(null);
    form.setValue("receipt", undefined);
  };

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
                      <SelectTrigger>
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
                    <Input placeholder="e.g., Monthly rent payment" {...field} />
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
                    <Input type="date" {...field} />
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
                  <FormDescription>Upload from device or take a photo.</FormDescription>

                  {/* hidden file inputs */}
                  <input
                    type="file"
                    accept="image/*"
                    id="receipt-upload-input"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setReceiptFile(f);
                      setReceiptPreview(f ? URL.createObjectURL(f) : null);
                    }}
                  />

                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    id="receipt-camera-input"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setReceiptFile(f);
                      setReceiptPreview(f ? URL.createObjectURL(f) : null);
                    }}
                  />

                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() =>
                        document.getElementById("receipt-upload-input")?.click()
                      }
                    >
                      Upload from device
                    </Button>

                    <Button
                      variant="outline"
                      type="button"
                      onClick={() =>
                        document.getElementById("receipt-camera-input")?.click()
                      }
                    >
                      Use camera
                    </Button>
                  </div>

                  {receiptPreview && (
                    <div className="mt-3 relative inline-block">
                      <img
                        src={receiptPreview}
                        className="max-h-40 rounded border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={removeReceipt}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

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
