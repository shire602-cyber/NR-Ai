import { DatePicker } from "@/components/ui/date-picker";
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { T } from "@/components/layout/T";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { CardListSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import {
  defaultPaymentAccountId,
  postablePaymentAccounts,
  type BankAccountLike,
} from "@/lib/payment-accounts";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { clearCsrfToken, withCsrfHeader } from "@/lib/csrf";
import { parseReceiptOcrText } from "@shared/receipt-ocr-parser";
import {
  BAND_LABELS,
  bandRequiresReview,
  deriveConfidenceBand,
  receiptReviewDecision,
  type ConfidenceBand,
  type ReviewSnapshot,
} from "@shared/receipt-confidence";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import {
  exportToExcel,
  exportToGoogleSheets,
  prepareReceiptsForExport,
  downloadOcrExcel,
  downloadReceiptsExcel,
  ocrDataToExportRow,
} from "@/lib/export";
import { evidenceSourceHref } from "@/lib/evidenceLinks";
import Tesseract from "tesseract.js";
import {
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  Camera,
  X,
  Trash2,
  RefreshCw,
  Edit,
  ListTree,
  Split,
  Download,
  FileSpreadsheet,
  ZoomIn,
  Brain,
  Bot,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReceiptAutomation } from "./ReceiptAutopilot";
import { ReceiptLinesDialog, type ReceiptForSplit } from "@/components/receipts/ReceiptLinesDialog";
import { SiGooglesheets } from "react-icons/si";
import { VirtualList } from "@/components/VirtualList";
import { formatCurrency, formatDate } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { accountDisplayName } from "@/lib/account-name";

interface ExtractedData {
  merchant?: string;
  date?: string;
  invoiceNumber?: string | null;
  subtotal?: number;
  vatPercentage?: number;
  vatAmount?: number;
  total?: number;
  currency?: string;
  rawText: string;
  category?: string;
  lineItems?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  confidence?: number;
  suggestedCategory?: string;
  classifier?: { method?: string; confidence?: number; reason?: string } | null;
  // Confidence banding and review routing (R05-23)
  confidenceBand?: ConfidenceBand;
  reviewReasons?: string[];
  reviewed?: boolean;
  original?: ReviewSnapshot;
  ocrSource?: string;
  // FTA tax-invoice signals (R05-17)
  supplierTrn?: string | null;
  isTaxInvoice?: boolean;
  simplifiedInvoice?: boolean;
  reverseChargeSuggested?: boolean;
  // Set after the server reported an exact duplicate and the user chose to upload anyway.
  confirmDuplicate?: boolean;
}

/** Fill in band + the "as extracted" snapshot used to record the reviewer's decision. */
function withReviewMeta(data: ExtractedData): ExtractedData {
  const band =
    data.confidenceBand ?? deriveConfidenceBand({ extractionConfidence: data.confidence }).band;
  return {
    ...data,
    confidenceBand: band,
    original: data.original ?? {
      merchant: data.merchant,
      date: data.date,
      total: data.total,
      vatAmount: data.vatAmount,
      category: data.category,
    },
  };
}

interface ProcessedReceipt {
  file: File;
  preview: string;
  status: "pending" | "processing" | "completed" | "saved" | "error" | "save_error";
  progress: number;
  data?: ExtractedData;
  error?: string;
  /** True when the server rejected the save as an exact duplicate (409). */
  duplicate?: boolean;
}

function isOcrRetryable(receipt: ProcessedReceipt): boolean {
  return receipt.status === "pending" || receipt.status === "error";
}

const receiptSchema = z.object({
  merchant: z.string().min(1, "forms.errors.merchantNameRequired"),
  date: z.string().min(1, "forms.errors.dateRequired"),
  amount: z.coerce.number().min(0, "forms.errors.amountPositive"),
  vatAmount: z.coerce.number().nullable(),
  category: z.string().nullable(),
  currency: z.string().default("AED"),
});

type ReceiptFormData = z.infer<typeof receiptSchema>;

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  pdfJsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjsLib, worker]) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjsLib;
  });
  return pdfJsPromise;
}

// Formats the receipt save route accepts. Anything else (notably iPhone HEIC)
// must be converted client-side first.
const SAVE_ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif)$/i;

// Convert an image the server won't accept (e.g. HEIC) to JPEG via canvas.
// Works wherever the browser can decode the source — Safari/iOS decode HEIC
// natively. Returns null if the browser can't decode it (e.g. HEIC in Chrome).
async function normalizeImageToJpeg(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(
            blob
              ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
              : null
          );
        },
        "image/jpeg",
        0.92
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Fetches a saved receipt's image via the authenticated server route and
// returns a blob URL the parent can show as a thumbnail or full preview.
// Returns `null` while loading and on any failure (including receipts with
// no stored image), so the caller can render a placeholder instead.
function useReceiptImageUrl(
  companyId: string | undefined,
  receiptId: string,
  hasImage: boolean
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || !receiptId || !hasImage) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/companies/${companyId}/receipts/${receiptId}/image`), {
          credentials: "include",
          headers: getAuthHeaders(),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setUrl(createdUrl);
      } catch {
        // Best effort — leave the placeholder visible.
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      // Reset in cleanup (not the effect body) so a dep change never leaves a
      // revoked blob URL on screen and the effect stays render-safe.
      setUrl(null);
    };
  }, [companyId, receiptId, hasImage]);

  return url;
}

interface ReceiptThumbnailProps {
  companyId: string | undefined;
  receipt: {
    id: string;
    imagePath?: string | null;
    imageData?: string | null;
    merchant?: string | null;
  };
  onPreview: (src: string, merchant?: string) => void;
}

function ReceiptThumbnail({ companyId, receipt, onPreview }: ReceiptThumbnailProps) {
  const hasImage = !!(receipt.imagePath || receipt.imageData);
  const url = useReceiptImageUrl(companyId, receipt.id, hasImage);

  if (!hasImage) {
    return (
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden
      >
        <FileText className="h-5 w-5" />
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"
        aria-hidden
      >
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onPreview(url, receipt.merchant ?? undefined)}
      className="group relative h-10 w-10 shrink-0 rounded-md overflow-hidden border hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Preview receipt image for ${receipt.merchant ?? "this receipt"}`}
      data-testid={`receipt-thumbnail-${receipt.id}`}
    >
      <img src={url} alt="" className="w-full h-full object-cover" />
      <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <ZoomIn className="w-4 h-4 text-white" />
      </span>
    </button>
  );
}

// Phase 2 — internal classifier methods that drive the "Internal" badge.
// Anything outside this set (typo, future schema value, null) renders no badge
// rather than a misleading "Internal" label with raw value text.
const INTERNAL_CLASSIFIER_METHODS = ["rule", "keyword", "statistical"] as const;
type InternalClassifierMethod = (typeof INTERNAL_CLASSIFIER_METHODS)[number];
function isInternalClassifierMethod(value: unknown): value is InternalClassifierMethod {
  return (
    typeof value === "string" && (INTERNAL_CLASSIFIER_METHODS as readonly string[]).includes(value)
  );
}

// Human-readable labels for how a category suggestion was derived, shown on
// the review card so users understand why a category was pre-filled.
const CLASSIFIER_METHOD_LABELS: Record<string, string> = {
  rule: "your company rules",
  keyword: "UAE keyword match",
  statistical: "your past classifications",
  openai: "AI vision",
};

/** Display label for a stored (English) receipt category; unknown categories show as stored. */
const RECEIPT_CATEGORY_KEYS: Record<string, string> = {
  "Office Supplies": "pageLabels.officeSupplies",
  Meals: "pages.receiptsCategoryMeals",
  Travel: "pages.travel",
  Utilities: "pages.utilities",
  Marketing: "pageLabels.marketing",
  Equipment: "pages.equipment",
  Communication: "pageLabels.communication",
  "Professional Services": "pages.professionalServices",
  Insurance: "pages.insurance",
  Maintenance: "pages.maintenance",
  Rent: "pages.receiptsCategoryRent",
  Other: "pages.other",
};

function receiptCategoryLabel(t: Record<string, string>, category: string): string {
  const key = RECEIPT_CATEGORY_KEYS[category];
  return (key && t[key]) || category;
}

export default function Receipts() {
  const { t, locale } = useTranslation();
  // Receipt-capture strings for the confidence/duplicate/TRN additions (en + ar).
  const tr = useCallback((en: string, ar: string) => (locale === "ar" ? ar : en), [locale]);
  const accountLabel = (a?: { nameEn: string; nameAr?: string | null }) =>
    a ? accountDisplayName(a, locale) : "";
  const { toast } = useToast();
  const { companyId, isLoading: _isLoadingCompany } = useDefaultCompany();
  // Spec 3.8: automation settings are a tab here (`/receipt-autopilot` redirects to it).
  const [receiptsTab, setReceiptsTab] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tab") === "automation"
      ? "automation"
      : "receipts"
  );
  // X3: ask up front whether automatic reading (AI/OCR) is enabled, so a scan never spins for a
  // minute and then fails. `false` = not enabled; undefined = still loading (scan proceeds).
  const { data: ocrStatus } = useQuery<{ aiConfigured: boolean }>({
    queryKey: ["/api/ocr/status"],
    staleTime: 5 * 60 * 1000,
  });
  const autoReadUnavailable = ocrStatus?.aiConfigured === false;
  const [processedReceipts, setProcessedReceipts] = useState<ProcessedReceipt[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [totalToSave, setTotalToSave] = useState(0);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<any>(null);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [postingReceipt, setPostingReceipt] = useState<any>(null);
  const [selectedExpenseAccount, setSelectedExpenseAccount] = useState<string>("");
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<string>("");
  const [createAccountDialogOpen, setCreateAccountDialogOpen] = useState(false);
  const [newAccountType, setNewAccountType] = useState<"expense" | "asset">("expense");
  const [newAccountCode, setNewAccountCode] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [similarWarningOpen, setSimilarWarningOpen] = useState(false);
  const [similarTransactions, setSimilarTransactions] = useState<any[]>([]);
  const [pendingSaveData, setPendingSaveData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [isOcrExporting, setIsOcrExporting] = useState(false);
  const [manualExpenseDialogOpen, setManualExpenseDialogOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ src: string; merchant?: string } | null>(null);
  // R05-19b (S2): split lines / revise a posted receipt / split one upload into receipts.
  const [linesDialog, setLinesDialog] = useState<{
    mode: "lines" | "split";
    receipt: ReceiptForSplit;
  } | null>(null);

  const manualExpenseForm = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      merchant: "",
      date: new Date().toISOString().split("T")[0],
      amount: 0,
      vatAmount: null,
      category: "",
      currency: "AED",
    },
  });

  // Fetch receipts
  const { data: receipts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "receipts"],
    enabled: !!companyId,
  });

  // Fetch accounts for posting
  const { data: accounts } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  // X5 (J1 D1): the payment account defaults to the primary bank account's GL.
  const { data: bankAccounts = [] } = useQuery<BankAccountLike[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      merchant: "",
      date: "",
      amount: 0,
      vatAmount: null,
      category: "",
      currency: "AED",
    },
  });

  // Save single receipt mutation
  const _saveReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/companies/${companyId}/receipts`, data);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReceiptFormData }) =>
      apiRequest("PUT", `/api/receipts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
      toast({
        title: tr("Receipt updated successfully", "تم تحديث الإيصال"),
        description: tr("Your receipt has been updated.", "تم تحديث إيصالك."),
      });
      setEditDialogOpen(false);
      setEditingReceipt(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("Failed to update receipt", "تعذّر تحديث الإيصال"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const postExpenseMutation = useMutation({
    mutationFn: ({
      id,
      accountId,
      paymentAccountId,
    }: {
      id: string;
      accountId: string;
      paymentAccountId: string;
    }) => apiRequest("POST", `/api/receipts/${id}/post`, { accountId, paymentAccountId }),
    onMutate: async ({ id }) => {
      const queryKey = ["/api/companies", companyId, "receipts"] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(
        queryKey,
        (old) => old?.map((r: any) => (r.id === id ? { ...r, posted: true } : r)) ?? []
      );
      return { previous, queryKey };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "journal-entries"] });
      toast({
        title: tr("Expense posted successfully", "تم ترحيل المصروف"),
        description: tr("Journal entry has been created.", "تم إنشاء قيد اليومية."),
      });
      setPostDialogOpen(false);
      setPostingReceipt(null);
      setSelectedExpenseAccount("");
      setSelectedPaymentAccount("");
    },
    onError: (error: any, _vars, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        variant: "destructive",
        title: tr("Failed to post expense", "تعذّر ترحيل المصروف"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
    },
  });

  const manualExpenseMutation = useMutation({
    mutationFn: async (data: ReceiptFormData) => {
      return apiRequest("POST", `/api/companies/${companyId}/receipts`, {
        merchant: data.merchant,
        date: data.date,
        amount: data.amount,
        vatAmount: data.vatAmount,
        category: data.category,
        currency: data.currency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
      toast({
        title: tr("Expense created successfully", "تم إنشاء المصروف"),
        description: tr(
          "The expense has been added. You can now post it to the journal.",
          "تمت إضافة المصروف. يمكنك الآن ترحيله إلى دفتر اليومية."
        ),
      });
      setManualExpenseDialogOpen(false);
      manualExpenseForm.reset();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("Failed to create expense", "تعذّر إنشاء المصروف"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/companies/${companyId}/accounts`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "accounts"] });
      toast({
        title: tr("Account created successfully", "تم إنشاء الحساب"),
        description: tr(`${data.nameEn} has been added.`, `تمت إضافة ${data.nameEn}.`),
      });
      setCreateAccountDialogOpen(false);
      setNewAccountCode("");
      setNewAccountName("");
      // Auto-select the new account if it matches the type
      if (newAccountType === "expense") {
        setSelectedExpenseAccount(data.id);
      } else if (newAccountType === "asset") {
        setSelectedPaymentAccount(data.id);
      }
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("Failed to create account", "تعذّر إنشاء الحساب"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const _checkSimilarMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", `/api/companies/${companyId}/receipts/check-similar`, data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/receipts/${id}`),
    onMutate: async (id: string) => {
      const queryKey = ["/api/companies", companyId, "receipts"] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(
        queryKey,
        (old) => old?.filter((r: any) => r.id !== id) ?? []
      );
      return { previous, queryKey };
    },
    onSuccess: () => {
      toast({
        title: tr("Expense deleted", "تم حذف المصروف"),
        description: tr("The expense has been deleted successfully.", "تم حذف المصروف."),
      });
    },
    onError: (error: any, _id, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        variant: "destructive",
        title: tr("Failed to delete expense", "تعذّر حذف المصروف"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
    },
  });

  const handleDeleteReceipt = (receipt: any) => {
    if (
      window.confirm("Are you sure you want to delete this expense? This action cannot be undone.")
    ) {
      deleteMutation.mutate(receipt.id);
    }
  };

  const handleEditReceipt = (receipt: any) => {
    setEditingReceipt(receipt);
    form.reset({
      merchant: receipt.merchant || "",
      date: receipt.date || "",
      amount: receipt.amount || 0,
      vatAmount: receipt.vatAmount || null,
      category: receipt.category || "",
      currency: receipt.currency || "AED",
    });
    setEditDialogOpen(true);
  };

  const handlePostExpense = (receipt: any) => {
    setPostingReceipt(receipt);
    setSelectedExpenseAccount("");
    const postable = postablePaymentAccounts(accounts ?? []);
    setSelectedPaymentAccount(
      postable.some((a) => a.id === receipt.paymentAccountId)
        ? receipt.paymentAccountId
        : defaultPaymentAccountId(accounts ?? [], bankAccounts)
    );
    setPostDialogOpen(true);
  };

  const submitPostExpense = () => {
    if (!postingReceipt || !selectedExpenseAccount || !selectedPaymentAccount) {
      toast({
        variant: "destructive",
        title: tr("Missing information", "معلومات ناقصة"),
        description: tr(
          "Please select both expense and payment accounts.",
          "يرجى اختيار حساب المصروف وحساب الدفع."
        ),
      });
      return;
    }

    postExpenseMutation.mutate({
      id: postingReceipt.id,
      accountId: selectedExpenseAccount,
      paymentAccountId: selectedPaymentAccount,
    });
  };

  const onEditSubmit = (data: ReceiptFormData) => {
    if (!editingReceipt) return;

    // Clean up data: convert empty strings to null for optional UUID fields, ensure numeric conversion
    const cleanedData = {
      ...data,
      amount: Number(data.amount),
      category: data.category === "" ? null : data.category,
      vatAmount:
        data.vatAmount === 0 || data.vatAmount === null || isNaN(data.vatAmount as number)
          ? null
          : Number(data.vatAmount),
    };

    editMutation.mutate({ id: editingReceipt.id, data: cleanedData });
  };

  const resetForm = () => {
    setProcessedReceipts([]);
    setIsProcessingBulk(false);
    setIsSavingAll(false);
    setTotalToSave(0);
  };

  const onManualExpenseSubmit = (data: ReceiptFormData) => {
    manualExpenseMutation.mutate({
      ...data,
      amount: Number(data.amount),
      vatAmount:
        data.vatAmount === 0 || data.vatAmount === null || isNaN(data.vatAmount as number)
          ? null
          : Number(data.vatAmount),
    });
  };

  // Safety cap so a huge PDF can't render thousands of pages into memory at once.
  const MAX_PDF_PAGES = 50;

  // Render EVERY page of a PDF to its own image. A multi-page PDF is almost always
  // a stack of separate receipts/bills (one per page), so each page becomes its
  // own receipt to scan — previously only page 1 was processed.
  const convertPdfToImages = async (
    file: File
  ): Promise<{
    pages: Array<{ blob: Blob; preview: string }>;
    total: number;
    rendered: number;
  }> => {
    const pdfjsLib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const total = pdf.numPages;
    const rendered = Math.min(total, MAX_PDF_PAGES);
    const pages: Array<{ blob: Blob; preview: string }> = [];

    for (let pageNum = 1; pageNum <= rendered; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const scale = 2;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport, canvas } as any).promise;
      const rendered1 = await new Promise<{ blob: Blob; preview: string }>((resolve) => {
        canvas.toBlob(
          (blob) => resolve({ blob: blob!, preview: canvas.toDataURL("image/png") }),
          "image/png"
        );
      });
      pages.push(rendered1);
    }

    return { pages, total, rendered };
  };

  const handleFilesSelect = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        // Accept by extension too — HEIC files sometimes arrive with an empty type.
        const isImage =
          file.type.startsWith("image/") ||
          /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

        if (!isImage && !isPdf) {
          toast({
            title: tr("Invalid file", "ملف غير صالح"),
            description: tr(
              `${file.name} must be an image or PDF file`,
              `يجب أن يكون الملف ${file.name} صورة أو ملف PDF`
            ),
            variant: "destructive",
          });
          continue;
        }

        if (isPdf) {
          try {
            toast({
              title: tr("Converting PDF", "جارٍ تحويل ملف PDF"),
              description: tr(
                `Reading all pages of ${file.name}...`,
                `جارٍ قراءة جميع صفحات ${file.name}...`
              ),
            });

            const { pages, total, rendered } = await convertPdfToImages(file);
            const baseName = file.name.replace(/\.pdf$/i, "");
            const newReceipts = pages.map((p, i) => ({
              file: new File(
                [p.blob],
                pages.length > 1 ? `${baseName} (p${i + 1}).png` : `${baseName}.png`,
                { type: "image/png" }
              ),
              preview: p.preview,
              status: "pending" as const,
              progress: 0,
            }));

            setProcessedReceipts((prev) => [...prev, ...newReceipts]);

            toast({
              title: tr("PDF ready", "ملف PDF جاهز"),
              description:
                locale === "ar"
                  ? rendered < total
                    ? `${file.name}: أُضيفت ${rendered} من ${total} صفحة (الحد الأقصى ${MAX_PDF_PAGES}). كل صفحة إيصال منفصل للمسح.`
                    : `${file.name}: أُضيفت ${rendered} صفحة — كل صفحة إيصال منفصل للمسح.`
                  : rendered < total
                    ? `${file.name}: ${rendered} of ${total} pages added (capped at ${MAX_PDF_PAGES}). Each page is a separate receipt to scan.`
                    : `${file.name}: ${rendered} page${rendered === 1 ? "" : "s"} added — each is a separate receipt to scan.`,
            });
          } catch (error: any) {
            console.error("PDF conversion error:", error);
            toast({
              title: tr("PDF conversion failed", "تعذّر تحويل ملف PDF"),
              description: tr(
                `Could not convert ${file.name}. Please upload an image instead (JPG, PNG, HEIC).`,
                `تعذّر تحويل ${file.name}. يرجى رفع صورة بدلاً منه (JPG أو PNG أو HEIC).`
              ),
              variant: "destructive",
            });
          }
        } else {
          // Normalize formats the save route rejects (notably iPhone HEIC) to JPEG.
          let imageFile = file;
          if (!SAVE_ALLOWED_IMAGE.test(file.type)) {
            const converted = await normalizeImageToJpeg(file);
            if (!converted) {
              toast({
                title: tr("Couldn't read this photo", "تعذّرت قراءة هذه الصورة"),
                description: tr(
                  `${file.name} is in a format this browser can't open (often iPhone HEIC). Open the app in Safari, or convert it to JPEG and re-upload.`,
                  `صيغة ${file.name} لا يستطيع هذا المتصفح فتحها (غالباً HEIC من آيفون). افتح التطبيق في Safari أو حوّل الصورة إلى JPEG وأعد رفعها.`
                ),
                variant: "destructive",
              });
              continue;
            }
            imageFile = converted;
          }
          const reader = new FileReader();
          reader.onload = (e) => {
            const preview = e.target?.result as string;
            setProcessedReceipts((prev) => [
              ...prev,
              {
                file: imageFile,
                preview,
                status: "pending",
                progress: 0,
              },
            ]);
          };
          reader.readAsDataURL(imageFile);
        }
      }
    },
    [toast, tr, locale]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const removeReceipt = (index: number) => {
    setProcessedReceipts((prev) => prev.filter((_, i) => i !== index));
  };

  /** Explain (en/ar) that automatic reading is off and open manual entry right away. */
  const explainAutoReadUnavailable = () => {
    toast({
      title: tr("Automatic reading isn't enabled yet", "القراءة التلقائية غير مفعّلة بعد"),
      description: tr(
        "We can't read receipts automatically yet. Enter the details yourself and attach the photo as evidence.",
        "لا يمكننا قراءة الإيصالات تلقائياً بعد. أدخل التفاصيل بنفسك وأرفق الصورة كإثبات."
      ),
    });
    setManualExpenseDialogOpen(true);
  };

  const processReceipt = async (index: number) => {
    const receipt = processedReceipts[index];
    if (!receipt) return;
    if (autoReadUnavailable) {
      explainAutoReadUnavailable();
      return;
    }

    setProcessedReceipts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], status: "processing", progress: 10, error: undefined };
      return updated;
    });

    try {
      // Strategy 1: Backend AI Vision OCR (GPT-4o)
      const toBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      const imageData = await toBase64(receipt.file);

      setProcessedReceipts((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], progress: 40 };
        return updated;
      });

      let parsed: ExtractedData | null = null;
      let backendErrorMessage: string | null = null;
      let backendErrorStatus: number | null = null;

      const normaliseOcrError = (status: number | null, message: string | null) => {
        if (status && status >= 500) {
          return tr(
            "The reading service is temporarily unavailable. Please try again in a moment.",
            "خدمة القراءة غير متاحة مؤقتاً. يرجى المحاولة بعد قليل."
          );
        }
        if (message && /failed to fetch|load failed|networkerror/i.test(message)) {
          return tr(
            "Could not reach the reading service. Please try again.",
            "تعذّر الوصول إلى خدمة القراءة. يرجى المحاولة مرة أخرى."
          );
        }
        if (!message || /internal server error/i.test(message)) {
          return tr(
            "Reading the receipt failed. Please try again.",
            "تعذّرت قراءة الإيصال. يرجى المحاولة مرة أخرى."
          );
        }
        return message;
      };

      const isCsrfInvalid = async (response: Response) => {
        if (response.status !== 403) return false;
        try {
          const body = await response.clone().json();
          return body?.code === "CSRF_INVALID";
        } catch {
          return false;
        }
      };

      const callBackendOcr = async () =>
        fetch(apiUrl("/api/ocr/process"), {
          method: "POST",
          headers: await withCsrfHeader("POST", {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          }),
          credentials: "include",
          body: JSON.stringify({ imageData, companyId }),
        });

      try {
        let response = await callBackendOcr();

        if (await isCsrfInvalid(response)) {
          clearCsrfToken();
          response = await callBackendOcr();
        }

        if (response.ok) {
          const result = await response.json();
          parsed = {
            merchant: result.merchant || "Unknown Merchant",
            date: result.date || new Date().toISOString().split("T")[0],
            invoiceNumber: result.invoiceNumber || null,
            subtotal: result.subtotal || result.amount || 0,
            vatPercentage: result.vatPercentage ?? 5,
            vatAmount: result.vatAmount || 0,
            total: result.total || result.amount || 0,
            currency: result.currency || "AED",
            category: result.category || "Other",
            lineItems: result.lineItems || [],
            rawText: result.rawText || "",
            // A missing confidence is LOW, never a flattering default (R05-15).
            confidence: typeof result.confidence === "number" ? result.confidence : 0,
            suggestedCategory: result.category || "Other",
            classifier: result.classifier || null,
            confidenceBand: result.confidenceBand,
            reviewReasons: Array.isArray(result.reviewReasons) ? result.reviewReasons : [],
            ocrSource: result.ocrSource,
            supplierTrn: result.supplierTrn ?? null,
            isTaxInvoice: Boolean(result.isTaxInvoice),
            simplifiedInvoice: Boolean(result.simplifiedInvoice),
            reverseChargeSuggested: Boolean(result.reverseChargeSuggested),
          };
          setProcessedReceipts((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], progress: 90 };
            return updated;
          });
        } else {
          backendErrorStatus = response.status;
          // Capture the server-provided message so we can surface it if Tesseract
          // also fails. Without this, users see a generic "Try a clearer image"
          // even when the real cause is a misconfigured AI key on the server.
          try {
            const body = await response.json();
            backendErrorMessage =
              body?.code === "AI_NOT_CONFIGURED"
                ? tr(
                    "Automatic reading isn't enabled yet. Enter the details manually.",
                    "القراءة التلقائية غير مفعّلة بعد. أدخل التفاصيل يدوياً."
                  )
                : normaliseOcrError(
                    response.status,
                    body?.message || `Backend OCR returned ${response.status}`
                  );
          } catch {
            backendErrorMessage = normaliseOcrError(
              response.status,
              `Backend OCR returned ${response.status}`
            );
          }
          console.warn("[OCR] Backend returned error:", response.status, backendErrorMessage);
        }
      } catch (backendError: any) {
        backendErrorMessage = normaliseOcrError(
          null,
          backendError?.message || "Network error contacting OCR service"
        );
        console.warn("[OCR] Backend Vision failed:", backendError);
      }

      // Strategy 2: local Tesseract fallback. Production CSP/worker loading can
      // make browser Tesseract fail noisily, so only use it in development.
      // In production we surface the backend OCR error directly.
      if (!parsed) {
        const canUseLocalFallback =
          import.meta.env.DEV &&
          backendErrorStatus !== 401 &&
          backendErrorStatus !== 403 &&
          backendErrorStatus !== 429;

        if (!canUseLocalFallback) {
          throw new Error(
            backendErrorMessage ||
              tr(
                "The reading service is temporarily unavailable. Please try again in a moment.",
                "خدمة القراءة غير متاحة مؤقتاً. يرجى المحاولة بعد قليل."
              )
          );
        }

        let tesseractText = "";
        try {
          const result = await Tesseract.recognize(receipt.file, "eng+ara", {
            logger: (m) => {
              if (m.status === "recognizing text") {
                setProcessedReceipts((prev) => {
                  const updated = [...prev];
                  updated[index] = {
                    ...updated[index],
                    progress: 40 + Math.round(m.progress * 50),
                  };
                  return updated;
                });
              }
            },
          });
          tesseractText = result.data.text;
        } catch (tesseractError: any) {
          // If Tesseract itself blew up (worker/WASM load failure under strict
          // CSP, etc.), surface the backend reason instead of a vague Tesseract
          // stack trace — that's almost always the actionable cause.
          const tessMsg = tesseractError?.message || "Tesseract failed to initialize";
          const composed = backendErrorMessage
            ? `${backendErrorMessage} (local OCR fallback also failed: ${tessMsg})`
            : `OCR fallback failed: ${tessMsg}`;
          throw new Error(composed);
        }

        if (!tesseractText || tesseractText.trim().length < 10) {
          // Prefer the actionable backend reason over the generic Tesseract msg.
          throw new Error(
            backendErrorMessage
              ? `${backendErrorMessage} (local OCR could not read the image)`
              : "Could not extract readable text from image. Try a clearer photo."
          );
        }

        parsed = parseReceiptText(tesseractText);
        if (!parsed.merchant && !parsed.total) {
          parsed.merchant = "Unknown Merchant";
          parsed.total = 0;
        }

        if (parsed.merchant || parsed.total) {
          try {
            const category = await categorizeWithAI(parsed);
            if (category) parsed.category = category;
          } catch (aiError) {
            console.error("AI categorization failed, continuing without it:", aiError);
          }
        }
      }

      setProcessedReceipts((prev) => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          status: "completed",
          data: withReviewMeta(parsed!),
          progress: 100,
        };
        return updated;
      });
    } catch (error: any) {
      console.error("OCR processing error:", error);
      setProcessedReceipts((prev) => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          status: "error",
          error:
            error?.message ||
            tr("Reading failed. Try a clearer image.", "تعذّرت القراءة. جرّب صورة أوضح."),
          progress: 0,
        };
        return updated;
      });
    }
  };

  const processAllReceipts = async () => {
    const indexesToProcess = processedReceipts
      .map((receipt, index) => (isOcrRetryable(receipt) ? index : -1))
      .filter((index) => index >= 0);

    if (indexesToProcess.length === 0) return;
    if (autoReadUnavailable) {
      explainAutoReadUnavailable();
      return;
    }

    setIsProcessingBulk(true);

    for (const index of indexesToProcess) {
      await processReceipt(index);
    }

    setIsProcessingBulk(false);
    toast({
      title: tr("Processing Complete", "اكتملت المعالجة"),
      description: tr(
        `Processed ${indexesToProcess.length} receipt(s)`,
        `تمت معالجة ${indexesToProcess.length} إيصال`
      ),
    });
  };

  const parseReceiptText = (text: string): ExtractedData => {
    return { ...parseReceiptOcrText(text), ocrSource: "browser-ocr" };
  };

  const categorizeWithAI = async (data: ExtractedData): Promise<string | null> => {
    if (!companyId) return null;

    try {
      const response = await fetch(apiUrl("/api/ai/categorize"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          companyId,
          description: `${data.merchant || "Unknown"} - ${data.total} ${data.currency}`,
          amount: data.total,
          currency: data.currency || "AED",
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return result.suggestedAccountName || result.category;
      }
    } catch (error) {
      console.error("AI categorization failed:", error);
    }
    return null;
  };

  const updateReceiptData = (index: number, updates: Partial<ExtractedData>) => {
    setProcessedReceipts((prev) => {
      const updated = [...prev];
      if (updated[index].data) {
        updated[index] = {
          ...updated[index],
          data: { ...updated[index].data!, ...updates },
        };
      }
      return updated;
    });
  };

  const saveAllReceipts = async () => {
    const completed = processedReceipts
      .map((r, i) => ({ receipt: r, index: i }))
      .filter(({ receipt }) => receipt.status === "completed" && receipt.data);
    // Confidence routing: low-confidence extractions need an explicit review click first.
    const completedIndices = completed.filter(
      ({ receipt }) =>
        !bandRequiresReview(receipt.data!.confidenceBand) || receipt.data!.reviewed === true
    );
    const heldForReview = completed.length - completedIndices.length;
    if (heldForReview > 0) {
      toast({
        title: tr("Review required", "المراجعة مطلوبة"),
        description: tr(
          `${heldForReview} low-confidence receipt(s) need review before saving`,
          `${heldForReview} إيصال(ات) منخفضة الثقة تحتاج إلى مراجعة قبل الحفظ`
        ),
        variant: "destructive",
      });
    }

    if (completedIndices.length === 0 && completed.length === 0) {
      toast({
        title: tr("No receipts to save", "لا توجد إيصالات للحفظ"),
        description: tr("Please process receipts before saving", "يرجى معالجة الإيصالات قبل الحفظ"),
        variant: "destructive",
      });
      return;
    }

    if (!companyId) {
      toast({
        title: tr("Error", "خطأ"),
        description: tr(
          "Company not found. Please try refreshing the page.",
          "لم يتم العثور على الشركة. يرجى تحديث الصفحة."
        ),
        variant: "destructive",
      });
      return;
    }

    if (completedIndices.length === 0) return;

    // Proceed with save directly - similar check removed for better UX
    await performSave(completedIndices);
  };

  const performSave = async (completedIndices: any[]) => {
    if (!companyId) {
      toast({
        title: tr("Error", "خطأ"),
        description: tr(
          "Company not found. Please try refreshing the page.",
          "لم يتم العثور على الشركة. يرجى تحديث الصفحة."
        ),
        variant: "destructive",
      });
      return;
    }

    // Capture total count before starting to prevent denominator from shrinking
    const total = completedIndices.length;
    setTotalToSave(total);
    setIsSavingAll(true);
    let successCount = 0;
    let errorCount = 0;
    let firstSaveError: string | undefined;

    // Save each receipt sequentially with status updates
    for (const { receipt, index } of completedIndices) {
      try {
        // The server derives companyId/uploader from the session and URL and rejects unknown
        // fields (W2-D), so only the fields the receipt contract accepts are sent.
        const receiptData = {
          merchant: receipt.data!.merchant || "Unknown",
          date: receipt.data!.date || new Date().toISOString().split("T")[0],
          amount: Number(receipt.data!.subtotal ?? receipt.data!.total) || 0,
          vatAmount: receipt.data!.vatAmount ? Number(receipt.data!.vatAmount) : null,
          category: receipt.data!.category || "Uncategorized",
          currency: receipt.data!.currency || "AED",
          imageData: receipt.preview,
          rawText: receipt.data!.rawText,
          suggestedCategory: receipt.data!.suggestedCategory ?? null,
          classifierMethod: receipt.data!.classifier?.method ?? null,
          classifierConfidence: receipt.data!.classifier?.confidence ?? null,
          classifierReason: receipt.data!.classifier?.reason ?? null,
          supplierTrn: receipt.data!.supplierTrn || undefined,
          confirmDuplicate: receipt.data!.confirmDuplicate === true ? true : undefined,
        };

        const created = await apiRequest(
          "POST",
          `/api/companies/${companyId}/receipts`,
          receiptData
        );

        // Fuzzy duplicate warning from the server: saved, but worth a second look.
        if (Array.isArray(created?.duplicateWarnings) && created.duplicateWarnings.length > 0) {
          toast({
            title: tr("Possible duplicate", "احتمال وجود تكرار"),
            description: tr(
              `A similar receipt from ${created.duplicateWarnings[0].merchant ?? "the same merchant"} already exists`,
              `يوجد إيصال مشابه من ${created.duplicateWarnings[0].merchant ?? "نفس التاجر"} بالفعل`
            ),
          });
        }

        // Record the human decision on the AI extraction for audit (non-fatal).
        if (created?.id && receipt.data!.confidenceBand) {
          apiRequest("POST", `/api/companies/${companyId}/receipts/${created.id}/review-decision`, {
            decision: receiptReviewDecision(receipt.data!.original, {
              merchant: receipt.data!.merchant,
              date: receipt.data!.date,
              total: receipt.data!.total,
              vatAmount: receipt.data!.vatAmount,
              category: receipt.data!.category,
            }),
            band: receipt.data!.confidenceBand,
          }).catch(() => {});
        }

        // Mark this receipt as saved
        setProcessedReceipts((prev) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: "saved" };
          return updated;
        });

        successCount++;
      } catch (error: any) {
        console.error("Failed to save receipt:", error);

        // Extract error message
        const isDuplicate = error?.status === 409;
        const errorMessage = isDuplicate
          ? tr("This file has already been uploaded.", "تم رفع هذا الملف من قبل.")
          : error?.message || "Failed to save to database";
        if (!firstSaveError) firstSaveError = errorMessage;

        // Mark this receipt as failed to save
        setProcessedReceipts((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            status: "save_error",
            error: errorMessage,
            duplicate: isDuplicate,
          };
          return updated;
        });

        errorCount++;
      }
    }

    // Wait for queries to invalidate and refresh
    await queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });

    setIsSavingAll(false);

    if (successCount > 0) {
      toast({
        title: tr("Receipts Saved", "تم حفظ الإيصالات"),
        description: tr(
          `Successfully saved ${successCount} receipt(s)${errorCount > 0 ? `. ${errorCount} failed` : ""}`,
          `تم حفظ ${successCount} إيصال بنجاح${errorCount > 0 ? `، وفشل ${errorCount}` : ""}`
        ),
      });

      // Only clear successfully saved receipts
      if (errorCount === 0) {
        resetForm();
      } else {
        // Remove only the saved ones, keep the failed ones for retry
        setProcessedReceipts((prev) => prev.filter((r) => r.status !== "saved"));
      }
    } else {
      toast({
        title: tr("Save Failed", "فشل الحفظ"),
        description: firstSaveError
          ? tr(`Couldn't save: ${firstSaveError}`, `تعذّر الحفظ: ${firstSaveError}`)
          : tr(
              "Failed to save any receipts. Please try again.",
              "تعذّر حفظ أي إيصال. يرجى المحاولة مرة أخرى."
            ),
        variant: "destructive",
      });
    }
  };

  // Warn before navigating away/refreshing while there are extracted-but-unsaved
  // receipts — they live only in memory until "Save All", so a refresh loses them.
  const hasUnsavedReceipts = processedReceipts.some((r) => r.status !== "saved");
  useEffect(() => {
    if (!hasUnsavedReceipts) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedReceipts]);

  const pendingCount = processedReceipts.filter((r) => r.status === "pending").length;
  const processingCount = processedReceipts.filter((r) => r.status === "processing").length;
  const completedCount = processedReceipts.filter((r) => r.status === "completed").length;
  const savedCount = processedReceipts.filter((r) => r.status === "saved").length;
  const errorCount = processedReceipts.filter((r) => r.status === "error").length;
  const saveErrorCount = processedReceipts.filter((r) => r.status === "save_error").length;
  const retryableOcrCount = processedReceipts.filter(isOcrRetryable).length;

  const filteredReceipts = useMemo(() => {
    if (!receipts || receipts.length === 0) return [];
    if (!dateRange.from && !dateRange.to) return receipts;

    const fromDate = dateRange.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange.to ? endOfDay(dateRange.to) : null;

    return receipts.filter((receipt: any) => {
      if (!receipt.date) return false;

      const receiptDate =
        typeof receipt.date === "string" ? parseISO(receipt.date) : new Date(receipt.date);

      if (fromDate && toDate) {
        return isWithinInterval(receiptDate, { start: fromDate, end: toDate });
      }
      if (fromDate) {
        return receiptDate >= fromDate;
      }
      if (toDate) {
        return receiptDate <= toDate;
      }
      return true;
    });
  }, [receipts, dateRange.from, dateRange.to]);

  const handleExportExcel = () => {
    if (!filteredReceipts.length) {
      toast({
        variant: "destructive",
        title: t["pages.receiptsNoData"],
        description: t["pages.receiptsNoExpensesExport"],
      });
      return;
    }

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    exportToExcel([prepareReceiptsForExport(filteredReceipts, locale)], `expenses${dateRangeStr}`);
    toast({
      title: tr("Export successful", "تم التصدير بنجاح"),
      description: tr(
        `${filteredReceipts.length} expenses exported to Excel`,
        `تم تصدير ${filteredReceipts.length} من المصروفات إلى Excel`
      ),
    });
  };

  const handleExportGoogleSheets = async () => {
    if (!companyId || !filteredReceipts.length) {
      toast({
        variant: "destructive",
        title: t["pages.receiptsNoData"],
        description: t["pages.receiptsNoExpensesExport"],
      });
      return;
    }

    setIsExporting(true);
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? ` (${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")})`
        : "";

    const result = await exportToGoogleSheets(
      [prepareReceiptsForExport(filteredReceipts, locale)],
      `Expenses${dateRangeStr}`,
      companyId
    );

    setIsExporting(false);

    if (result.success) {
      toast({
        title: tr("Export successful", "تم التصدير بنجاح"),
        description: tr(
          `${filteredReceipts.length} expenses exported to Google Sheets`,
          `تم تصدير ${filteredReceipts.length} من المصروفات إلى Google Sheets`
        ),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: tr("Export failed", "فشل التصدير"),
        description:
          result.error ||
          tr("Failed to export to Google Sheets", "تعذّر التصدير إلى Google Sheets"),
      });
    }
  };

  // Server-rendered Excel of the OCR-extracted rows currently on screen
  // (post-extraction, pre-save). Skips rows that haven't completed OCR yet.
  const handleDownloadOcrExcel = async () => {
    const rows = processedReceipts
      .filter((r) => r.status === "completed" || r.status === "saved")
      .filter((r) => r.data)
      .map((r) => ocrDataToExportRow(r.data!));

    if (rows.length === 0) {
      toast({
        variant: "destructive",
        title: tr("Nothing to export", "لا يوجد ما يمكن تصديره"),
        description: tr(
          "Process at least one receipt before downloading.",
          "عالج إيصالاً واحداً على الأقل قبل التنزيل."
        ),
      });
      return;
    }

    setIsOcrExporting(true);
    try {
      await downloadOcrExcel(rows);
      toast({
        title: tr("Excel ready", "ملف Excel جاهز"),
        description: tr(
          `${rows.length} receipt${rows.length === 1 ? "" : "s"} exported to Excel.`,
          `تم تصدير ${rows.length} إيصال إلى Excel.`
        ),
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: tr("Export failed", "فشل التصدير"),
        description:
          err?.message || tr("Could not generate the spreadsheet.", "تعذّر إنشاء ملف الجدول."),
      });
    } finally {
      setIsOcrExporting(false);
    }
  };

  // Bulk export of saved receipts via the server endpoint — same column layout
  // as the OCR export, so users get a consistent spreadsheet format for both
  // in-flight scans and historical data.
  const handleDownloadReceiptsExcel = async () => {
    if (!companyId || !filteredReceipts.length) {
      toast({
        variant: "destructive",
        title: t["pages.receiptsNoData"],
        description: t["pages.receiptsNoExpensesExport"],
      });
      return;
    }
    setIsExporting(true);
    try {
      await downloadReceiptsExcel(companyId, {
        ids: filteredReceipts.map((r: any) => r.id),
      });
      toast({
        title: tr("Excel ready", "ملف Excel جاهز"),
        description: tr(
          `${filteredReceipts.length} receipts exported.`,
          `تم تصدير ${filteredReceipts.length} إيصال.`
        ),
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: tr("Export failed", "فشل التصدير"),
        description:
          err?.message || tr("Could not generate the spreadsheet.", "تعذّر إنشاء ملف الجدول."),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Purchases"
        title={t["purchases.receiptsTitle"]}
        description={autoReadUnavailable ? t["pages.receiptsSubtitleManual"] : (t as any).receiptScannerSubtitle}
        actions={
          <Button
            onClick={() => setManualExpenseDialogOpen(true)}
            className="w-full sm:w-auto"
            data-testid="button-add-manual-expense"
          >
            <Plus className="w-4 h-4" />
            <T k="pageLabels.addExpenseManually" />
          </Button>
        }
      />

      <Tabs value={receiptsTab} onValueChange={setReceiptsTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="receipts" data-testid="tab-receipts">
            {t["purchases.receiptsTab"]}
          </TabsTrigger>
          <TabsTrigger value="automation" data-testid="tab-receipt-automation">
            {t["purchases.automationTab"]}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="receipts" className="mt-0 space-y-6">
          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                <T k="pageLabels.uploadReceipts" />
              </CardTitle>
              <CardDescription>{t["pages.receiptsUploadDescription"]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                flex min-h-40 flex-col justify-center rounded-lg border border-dashed p-5 text-center transition-colors duration-fast
                ${isDragging ? "border-primary bg-primary/5" : "border-border"}
                ${processedReceipts.length > 0 ? "border-primary/60 bg-primary/5" : ""}
                hover:border-primary hover:bg-muted/60 cursor-pointer
              `}
                onClick={() => document.getElementById("file-input")?.click()}
                data-testid="drop-zone"
              >
                <input
                  id="file-input"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="sr-only"
                  aria-label={t["pages.receiptsUploadInputLabel"]}
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) handleFilesSelect(files);
                  }}
                  data-testid="input-file"
                />

                {processedReceipts.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-2 text-primary">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>
                        {formatMessage(t["pages.receiptsImagesLoaded"], {
                          count: processedReceipts.length,
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <T k="pageLabels.clickOrDropMoreImagesTo" />
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                        <Camera
                          className="h-5 w-5 text-neutral-500"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-h3 text-foreground">{t["purchases.dropReceipts"]}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {t["pages.receiptsBrowseHint"]}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t["pages.receiptsSupportedTypes"]}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        document.getElementById("file-input")?.click();
                      }}
                      data-testid="button-browse-receipts"
                    >
                      <T k="pageLabels.browseFiles" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {processedReceipts.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    onClick={processAllReceipts}
                    disabled={isProcessingBulk || retryableOcrCount === 0}
                    className="flex-1"
                    size="lg"
                    data-testid="button-process-all"
                  >
                    {isProcessingBulk ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <T k="invoices.processing" />
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        {errorCount > 0 && pendingCount === 0
                          ? formatMessage(t["screens.retryFailedOcr"], { count: errorCount })
                          : errorCount > 0
                            ? formatMessage(t["screens.processRetryOcr"], {
                                count: retryableOcrCount,
                              })
                            : formatMessage(t["screens.processAllReceipts"], {
                                count: pendingCount,
                              })}
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={saveAllReceipts}
                    disabled={completedCount === 0 || isSavingAll || isProcessingBulk}
                    className="flex-1"
                    size="lg"
                    data-testid="button-save-all"
                  >
                    {isSavingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {formatMessage(t["screens.savingProgress"], {
                          done: savedCount,
                          total: totalToSave,
                        })}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        {formatMessage(t["screens.saveAllCount"], { count: completedCount })}
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={handleDownloadOcrExcel}
                    disabled={completedCount === 0 || isOcrExporting || isProcessingBulk}
                    size="lg"
                    data-testid="button-download-ocr-excel"
                  >
                    {isOcrExporting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <T k="pageLabels.preparing" />
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-4 h-4" />
                        {tr("Download Excel", "تنزيل Excel")} ({completedCount})
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={resetForm}
                    disabled={isProcessingBulk}
                    data-testid="button-reset"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {/* Status Summary */}
              {processedReceipts.length > 0 && (
                <div className="flex flex-wrap gap-2 text-sm">
                  {pendingCount > 0 && (
                    <Badge variant="outline">
                      {pendingCount} {tr("pending", "قيد الانتظار")}
                    </Badge>
                  )}
                  {processingCount > 0 && (
                    <Badge variant="outline">
                      {processingCount} {tr("processing", "قيد المعالجة")}
                    </Badge>
                  )}
                  {completedCount > 0 && (
                    <StatusBadge tone="success">
                      {completedCount} {tr("ready to save", "جاهزة للحفظ")}
                    </StatusBadge>
                  )}
                  {savedCount > 0 && (
                    <StatusBadge tone="info">
                      {savedCount} {tr("saved", "تم حفظها")}
                    </StatusBadge>
                  )}
                  {errorCount > 0 && (
                    <StatusBadge tone="danger">
                      {errorCount} {tr("OCR errors", "أخطاء قراءة")}
                    </StatusBadge>
                  )}
                  {saveErrorCount > 0 && (
                    <StatusBadge tone="warning">
                      {saveErrorCount} {tr("save failed", "فشل الحفظ")}
                    </StatusBadge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Processed Receipts */}
          {processedReceipts.length > 0 && (
            <div className="space-y-3">
              {processedReceipts.map((receipt, index) => (
                <Card key={index} data-testid={`receipt-card-${index}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row">
                      {/* Thumbnail — click to view source image alongside extracted data */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setImagePreview({
                              src: receipt.preview,
                              merchant: receipt.data?.merchant,
                            })
                          }
                          className="group relative block w-24 h-24 rounded-lg overflow-hidden border hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={t["pages.receiptsPreviewSource"]}
                          data-testid={`ocr-thumbnail-${index}`}
                        >
                          <img
                            src={receipt.preview}
                            alt={`Receipt ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ZoomIn className="w-5 h-5 text-white" />
                          </span>
                        </button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -end-2 h-6 w-6"
                          onClick={() => removeReceipt(index)}
                          disabled={isProcessingBulk}
                          data-testid={`button-remove-${index}`}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>

                      {/* Status and Data */}
                      <div className="flex-1 space-y-3">
                        {receipt.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              <T k="hr.status.pending" />
                            </Badge>
                            <p className="text-sm text-muted-foreground">
                              {autoReadUnavailable ? (
                                t["pages.receiptsReadyToAttach"]
                              ) : (
                                <T k="pageLabels.readyToProcess" />
                              )}
                            </p>
                          </div>
                        )}

                        {receipt.status === "processing" && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <T k="pageLabels.processingWithOcr" />
                              </span>
                              <span>{receipt.progress}%</span>
                            </div>
                            <Progress value={receipt.progress} />
                          </div>
                        )}

                        {receipt.status === "error" && (
                          <div className="flex flex-wrap items-center gap-2 text-destructive">
                            <XCircle className="w-4 h-4 shrink-0" />
                            <span className="text-sm">{receipt.error}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="ms-0 text-foreground sm:ms-2"
                              onClick={() => processReceipt(index)}
                              disabled={isProcessingBulk}
                              data-testid={`button-retry-ocr-${index}`}
                            >
                              <RefreshCw className="w-3 h-3" />
                              <T k="pageLabels.tryAgain" />
                            </Button>
                          </div>
                        )}

                        {receipt.status === "saved" && (
                          <div className="flex items-center gap-2 text-success">
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm font-medium">
                              <T k="pageLabels.successfullySavedToDatabase" />
                            </span>
                          </div>
                        )}

                        {receipt.status === "save_error" && (
                          <div className="flex flex-wrap items-center gap-2 text-danger">
                            <XCircle className="w-4 h-4" />
                            <span className="text-sm">{receipt.error || "Failed to save"}</span>
                            {receipt.duplicate && receipt.data && (
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`button-upload-anyway-${index}`}
                                onClick={() => {
                                  setProcessedReceipts((prev) => {
                                    const updated = [...prev];
                                    updated[index] = {
                                      ...updated[index],
                                      status: "completed",
                                      duplicate: false,
                                      error: undefined,
                                      data: { ...updated[index].data!, confirmDuplicate: true },
                                    };
                                    return updated;
                                  });
                                }}
                              >
                                {tr("Upload anyway", "رفع على أي حال")}
                              </Button>
                            )}
                          </div>
                        )}

                        {receipt.status === "completed" && receipt.data && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Merchant / Supplier</Label>
                              <Input
                                value={receipt.data.merchant || ""}
                                onChange={(e) =>
                                  updateReceiptData(index, { merchant: e.target.value })
                                }
                                className="h-8"
                                data-testid={`input-merchant-${index}`}
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Date</Label>
                              <DatePicker
                                value={receipt.data.date || ""}
                                onChange={(value) => updateReceiptData(index, { date: value })}
                                className="h-8"
                                data-testid={`input-date-${index}`}
                              />
                            </div>

                            {receipt.data.invoiceNumber && (
                              <div className="space-y-1 col-span-2">
                                <Label className="text-xs">Invoice / Receipt Number</Label>
                                <Input
                                  value={receipt.data.invoiceNumber || ""}
                                  onChange={(e) =>
                                    updateReceiptData(index, { invoiceNumber: e.target.value })
                                  }
                                  className="h-8"
                                />
                              </div>
                            )}

                            <div className="space-y-1">
                              <Label className="text-xs">Subtotal (excl. VAT)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={receipt.data.subtotal ?? receipt.data.total ?? ""}
                                onChange={(e) =>
                                  updateReceiptData(index, { subtotal: parseFloat(e.target.value) })
                                }
                                className="h-8"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">
                                VAT ({receipt.data.vatPercentage ?? 5}%)
                              </Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={receipt.data.vatAmount ?? ""}
                                onChange={(e) =>
                                  updateReceiptData(index, {
                                    vatAmount: parseFloat(e.target.value),
                                  })
                                }
                                className="h-8"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs font-semibold">Total (incl. VAT)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={receipt.data.total ?? ""}
                                onChange={(e) =>
                                  updateReceiptData(index, { total: parseFloat(e.target.value) })
                                }
                                className="h-8 font-semibold"
                                data-testid={`input-amount-${index}`}
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">
                                <T k="pages.category" />
                              </Label>
                              <Select
                                value={receipt.data.category}
                                onValueChange={(value) =>
                                  updateReceiptData(index, { category: value })
                                }
                              >
                                <SelectTrigger
                                  className="h-8"
                                  data-testid={`select-category-${index}`}
                                >
                                  <SelectValue placeholder={t["forms.claim.category"]} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Office Supplies">
                                    <T k="pageLabels.officeSupplies" />
                                  </SelectItem>
                                  <SelectItem value="Meals">
                                    {t["pages.receiptsCategoryMeals"]}
                                  </SelectItem>
                                  <SelectItem value="Travel">
                                    <T k="pages.travel" />
                                  </SelectItem>
                                  <SelectItem value="Utilities">
                                    <T k="pages.utilities" />
                                  </SelectItem>
                                  <SelectItem value="Marketing">
                                    <T k="pageLabels.marketing" />
                                  </SelectItem>
                                  <SelectItem value="Equipment">
                                    <T k="pages.equipment" />
                                  </SelectItem>
                                  <SelectItem value="Communication">
                                    <T k="pageLabels.communication" />
                                  </SelectItem>
                                  <SelectItem value="Professional Services">
                                    <T k="pages.professionalServices" />
                                  </SelectItem>
                                  <SelectItem value="Insurance">
                                    <T k="pages.insurance" />
                                  </SelectItem>
                                  <SelectItem value="Maintenance">
                                    <T k="pages.maintenance" />
                                  </SelectItem>
                                  <SelectItem value="Rent">
                                    {t["pages.receiptsCategoryRent"]}
                                  </SelectItem>
                                  <SelectItem value="Other">
                                    <T k="pages.other" />
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {receipt.data.lineItems && receipt.data.lineItems.length > 0 && (
                              <div className="col-span-2 space-y-1">
                                <Label className="text-xs">
                                  <T k="pages.lineItems" />
                                </Label>
                                <div className="rounded border text-xs divide-y">
                                  {receipt.data.lineItems.map((item, i) => (
                                    <div key={i} className="flex justify-between px-2 py-1">
                                      <span className="truncate max-w-[60%]">
                                        {item.description}
                                      </span>
                                      <span className="text-muted-foreground ms-2">
                                        {item.quantity > 1 ? `×${item.quantity}  ` : ""}
                                        {item.total.toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {receipt.data.confidenceBand && (
                              <div
                                className="col-span-2 space-y-1"
                                data-testid={`confidence-band-${index}`}
                              >
                                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant={
                                      receipt.data.confidenceBand === "high"
                                        ? "secondary"
                                        : "outline"
                                    }
                                    className={
                                      receipt.data.confidenceBand === "low"
                                        ? "border-destructive text-destructive"
                                        : undefined
                                    }
                                    data-testid={`badge-band-${receipt.data.confidenceBand}-${index}`}
                                  >
                                    <Sparkles className="w-2 h-2 me-1" />
                                    {
                                      BAND_LABELS[receipt.data.confidenceBand][
                                        locale === "ar" ? "ar" : "en"
                                      ]
                                    }
                                  </Badge>
                                  {typeof receipt.data.confidence === "number" && (
                                    <span>
                                      {tr("Model confidence", "ثقة النموذج")}:{" "}
                                      {Math.round(receipt.data.confidence * 100)}%
                                    </span>
                                  )}
                                  <span>
                                    {receipt.data.ocrSource === "browser-ocr" ||
                                    receipt.data.ocrSource === "tesseract" ||
                                    receipt.data.ocrSource === "text-parser"
                                      ? tr("Local OCR", "التعرف المحلي")
                                      : tr("AI vision", "الرؤية الذكية")}
                                  </span>
                                </p>
                                {receipt.data.reviewReasons &&
                                  receipt.data.reviewReasons.length > 0 && (
                                    <ul className="text-xs text-muted-foreground list-disc ps-4">
                                      {receipt.data.reviewReasons.map((reason, i) => (
                                        <li key={i}>{reason}</li>
                                      ))}
                                    </ul>
                                  )}
                                {bandRequiresReview(receipt.data.confidenceBand) && (
                                  <Button
                                    variant={receipt.data.reviewed ? "secondary" : "outline"}
                                    size="sm"
                                    data-testid={`button-mark-reviewed-${index}`}
                                    onClick={() =>
                                      updateReceiptData(index, {
                                        reviewed: !receipt.data!.reviewed,
                                      })
                                    }
                                  >
                                    {receipt.data.reviewed
                                      ? tr("Reviewed - ready to save", "تمت المراجعة - جاهز للحفظ")
                                      : tr(
                                          "I have checked these figures",
                                          "لقد تحققت من هذه الأرقام"
                                        )}
                                  </Button>
                                )}
                              </div>
                            )}

                            {(receipt.data.supplierTrn ||
                              receipt.data.isTaxInvoice ||
                              receipt.data.reverseChargeSuggested ||
                              receipt.data.ocrSource === "ai") && (
                              <div
                                className="col-span-2 flex flex-wrap gap-2 text-xs"
                                data-testid={`tax-invoice-signals-${index}`}
                              >
                                {receipt.data.supplierTrn && (
                                  <Badge variant="outline" dir="ltr">
                                    TRN {receipt.data.supplierTrn}
                                  </Badge>
                                )}
                                {receipt.data.isTaxInvoice && (
                                  <Badge variant="secondary">
                                    {receipt.data.simplifiedInvoice
                                      ? tr("Simplified tax invoice", "فاتورة ضريبية مبسطة")
                                      : tr("Tax invoice", "فاتورة ضريبية")}
                                  </Badge>
                                )}
                                {!receipt.data.isTaxInvoice && receipt.data.ocrSource === "ai" && (
                                  <Badge variant="outline">
                                    {tr(
                                      "Not a tax invoice - VAT may not be recoverable",
                                      "ليست فاتورة ضريبية - قد لا تُسترد ضريبة القيمة المضافة"
                                    )}
                                  </Badge>
                                )}
                                {receipt.data.reverseChargeSuggested && (
                                  <Badge variant="outline">
                                    {tr("Reverse charge suggested", "يُقترح الاحتساب العكسي")}
                                  </Badge>
                                )}
                              </div>
                            )}

                            {receipt.data.classifier?.method && (
                              <div className="col-span-2">
                                <p
                                  className="text-xs text-muted-foreground"
                                  data-testid={`text-classifier-why-${index}`}
                                  title={receipt.data.classifier.reason || undefined}
                                >
                                  Category suggested by{" "}
                                  <span className="font-medium text-foreground">
                                    {CLASSIFIER_METHOD_LABELS[receipt.data.classifier.method] ??
                                      receipt.data.classifier.method}
                                  </span>
                                  {typeof receipt.data.classifier.confidence === "number" && (
                                    <>
                                      {" "}
                                      · {Math.round(receipt.data.classifier.confidence * 100)}%
                                      confident
                                    </>
                                  )}
                                  . You can change it above — your correction trains the model.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Recent Receipts */}
          <section className="space-y-4" aria-labelledby="recent-expenses-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 id="recent-expenses-title" className="text-h2 text-foreground">
                  <T k="pageLabels.recentExpenses" />
                </h2>
                <p className="mt-1 text-small text-muted-foreground">
                  <T k="pageLabels.previouslyScannedAndSavedExpenses" />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={isExporting}
                      data-testid="button-export-expenses"
                    >
                      <Download aria-hidden />
                      {isExporting ? t["pages.receiptsExporting"] : t["pages.receiptsExport"]}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleExportExcel}
                      data-testid="menu-export-expenses-excel"
                    >
                      <FileSpreadsheet aria-hidden />
                      {t["pages.receiptsExportExcelFull"]}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleDownloadReceiptsExcel}
                      data-testid="menu-export-expenses-excel-ocr"
                    >
                      <FileSpreadsheet aria-hidden />
                      {t["pages.receiptsExportExcelOcr"]}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleExportGoogleSheets}
                      data-testid="menu-export-expenses-sheets"
                    >
                      <SiGooglesheets aria-hidden />
                      <T k="reportCenter.exportToGoogleSheets" />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <Card className="overflow-hidden">
              {isLoading ? (
                <div className="p-4">
                  <CardListSkeleton count={4} />
                </div>
              ) : filteredReceipts && filteredReceipts.length > 0 ? (
                <VirtualList
                  items={filteredReceipts as any[]}
                  estimateSize={64}
                  height={Math.min(720, Math.max(320, filteredReceipts.length * 64))}
                  getKey={(receipt) => receipt.id}
                  renderItem={(receipt: any) => (
                    <div
                      key={receipt.id}
                      className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5 transition-colors duration-fast hover:bg-muted/50"
                      data-testid={`receipt-${receipt.id}`}
                    >
                      <ReceiptThumbnail
                        companyId={companyId}
                        receipt={receipt}
                        onPreview={(src, merchant) => setImagePreview({ src, merchant })}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p dir="auto" className="truncate text-sm font-medium text-foreground">
                            {receipt.merchant || t["screens.unknownMerchant"]}
                          </p>
                          <Money
                            amount={Number(receipt.amount || 0)}
                            currency={receipt.currency || "AED"}
                            className="shrink-0 text-sm font-semibold text-foreground"
                          />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-caption text-muted-foreground">
                            {receipt.date ? formatDate(receipt.date, locale) : "—"}
                            {" · "}
                            {receipt.category
                              ? receiptCategoryLabel(t, receipt.category)
                              : t["pages.receiptsUncategorized"]}
                            {isInternalClassifierMethod(receipt.classifierMethod) && (
                              <span
                                className="ms-2 inline-flex items-center gap-1"
                                data-testid={`badge-classifier-internal-${receipt.id}`}
                                title={t["screens.classifiedInternally"]}
                              >
                                <Brain className="h-3 w-3" aria-hidden />
                                <T k="pageLabels.internal" />
                              </span>
                            )}
                            {receipt.classifierMethod === "openai" && (
                              <span
                                className="ms-2 inline-flex items-center gap-1"
                                data-testid={`badge-classifier-ai-${receipt.id}`}
                                title={t["screens.classifiedByAi"]}
                              >
                                <Bot className="h-3 w-3" aria-hidden />
                                {t["screens.aiLabel"]}
                              </span>
                            )}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {receipt.autoPosted ? (
                              <Badge
                                variant="success"
                                dot
                                data-testid={`badge-auto-posted-${receipt.id}`}
                                title={t["screens.autoPostedHint"]}
                              >
                                <T k="reportCenter.autoPosted" />
                              </Badge>
                            ) : receipt.posted ? (
                              <Badge variant="success" dot>
                                <T k="hr.status.posted" />
                              </Badge>
                            ) : (
                              <Badge variant="warning" dot>
                                {t["screens.statusUnposted"]}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <RowActions
                        maxInline={1}
                        collapseOnMobile
                        className="-me-2 shrink-0 md:w-[6.5rem]"
                        menu={
                          <>
                            <DropdownMenuItem
                              onSelect={() => setLinesDialog({ mode: "lines", receipt })}
                              data-testid={`button-lines-receipt-${receipt.id}`}
                            >
                              <ListTree aria-hidden />
                              {receipt.posted
                                ? t["purchases.reviseReceipt"]
                                : t["purchases.splitLines"]}
                            </DropdownMenuItem>
                            {!receipt.posted && (
                              <DropdownMenuItem
                                onSelect={() => setLinesDialog({ mode: "split", receipt })}
                                data-testid={`button-split-receipt-${receipt.id}`}
                              >
                                <Split aria-hidden />
                                {t["purchases.splitReceipt"]}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem asChild>
                              <Link
                                href={evidenceSourceHref("receipt", receipt.id)}
                                data-testid={`button-proof-receipt-${receipt.id}`}
                              >
                                <FileText aria-hidden />
                                <T k="reportCenter.proof" />
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => handleDeleteReceipt(receipt)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-receipt-${receipt.id}`}
                            >
                              <Trash2 aria-hidden />
                              {t.delete}
                            </DropdownMenuItem>
                          </>
                        }
                      >
                        {!receipt.posted && (
                          <RowActionButton
                            label={t["pages.receiptsPost"]}
                            icon={CheckCircle2}
                            onClick={() => handlePostExpense(receipt)}
                            data-testid={`button-post-receipt-${receipt.id}`}
                          />
                        )}
                        <RowActionButton
                          label={t.edit}
                          icon={Edit}
                          onClick={() => handleEditReceipt(receipt)}
                          data-testid={`button-edit-receipt-${receipt.id}`}
                        />
                      </RowActions>
                    </div>
                  )}
                />
              ) : (
                <EmptyState
                  icon={Upload}
                  title={
                    dateRange.from || dateRange.to
                      ? t["pages.receiptsEmptyRangeTitle"]
                      : t["pages.receiptsEmptyTitle"]
                  }
                  description={
                    dateRange.from || dateRange.to
                      ? t["pages.receiptsEmptyRangeBody"]
                      : autoReadUnavailable
                        ? t["pages.receiptsEmptyBodyManual"]
                        : t["pages.receiptsEmptyBody"]
                  }
                  action={
                    !(dateRange.from || dateRange.to)
                      ? {
                          label: t["pages.receiptsUploadReceipt"],
                          icon: Upload,
                          onClick: () => document.getElementById("file-input")?.click(),
                          testId: "button-upload-first-receipt",
                        }
                      : undefined
                  }
                  secondaryAction={
                    dateRange.from || dateRange.to
                      ? {
                          label: t["screens.clearFilter"],
                          onClick: () => setDateRange({ from: undefined, to: undefined }),
                        }
                      : undefined
                  }
                  testId="empty-state-receipts"
                />
              )}
            </Card>
          </section>
        </TabsContent>
        <TabsContent value="automation" className="mt-0">
          <ReceiptAutomation />
        </TabsContent>
      </Tabs>

      <ReceiptLinesDialog
        open={!!linesDialog}
        onOpenChange={(open) => !open && setLinesDialog(null)}
        mode={linesDialog?.mode ?? "lines"}
        receipt={linesDialog?.receipt ?? null}
        accounts={accounts ?? []}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
          toast({ title: t["purchases.receiptSaved"] });
        }}
      />

      {/* Source Image Preview Dialog — lets users compare OCR output against the original. */}
      <Dialog open={!!imagePreview} onOpenChange={(open) => !open && setImagePreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.sourceReceiptImage" />
            </DialogTitle>
            <DialogDescription>
              {imagePreview?.merchant
                ? `Original scanned image for ${imagePreview.merchant}`
                : t["pages.receiptsOriginalImage"]}
            </DialogDescription>
          </DialogHeader>
          {imagePreview && (
            <div className="flex items-center justify-center bg-muted/30 rounded-md p-2 max-h-[75vh] overflow-auto">
              <img
                src={imagePreview.src}
                alt="Source receipt"
                className="max-w-full h-auto rounded"
                data-testid="image-preview-full"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Receipt Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent size="md" data-testid="dialog-edit-receipt">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.editReceipt" />
            </DialogTitle>
            <DialogDescription>
              <T k="pageLabels.updateReceiptDetails" />
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} noValidate className="space-y-6">
              <FormErrorSummary />
              <FormGrid>
                <FormField
                  control={form.control}
                  name="merchant"
                  render={({ field }) => (
                    <FormItem className={formSpanFull}>
                      <FormLabel required>
                        <T k="pages.merchant" />
                      </FormLabel>
                      <FormControl>
                        <Input {...field} dir="auto" data-testid="input-edit-merchant" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t.date}</FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          data-testid="input-edit-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        <T k="banking.common.amount" />
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                          }
                          data-testid="input-edit-amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vatAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t["screens.vatAmountAed"]}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value ? parseFloat(e.target.value) : null)
                          }
                          data-testid="input-edit-vat"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <T k="pages.category" />
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-category">
                            <SelectValue placeholder={t["screens.selectCategory"]} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Office Supplies">
                            <T k="pageLabels.officeSupplies" />
                          </SelectItem>
                          <SelectItem value="Meals & Entertainment">
                            <T k="pageLabels.mealsEntertainment" />
                          </SelectItem>
                          <SelectItem value="Travel">
                            <T k="pages.travel" />
                          </SelectItem>
                          <SelectItem value="Utilities">
                            <T k="pages.utilities" />
                          </SelectItem>
                          <SelectItem value="Marketing">
                            <T k="pageLabels.marketing" />
                          </SelectItem>
                          <SelectItem value="Software">
                            <T k="pageLabels.software" />
                          </SelectItem>
                          <SelectItem value="Other">
                            <T k="pages.other" />
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  <T k="banking.common.cancel" />
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={editMutation.isPending}
                  data-testid="button-submit-edit-receipt"
                >
                  {editMutation.isPending ? t["forms.saving"] : t.save}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Similar Transactions Warning Dialog */}
      <Dialog open={similarWarningOpen} onOpenChange={setSimilarWarningOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-warning" />
              <T k="pageLabels.similarTransactionsFound" />
            </DialogTitle>
            <DialogDescription>
              <T k="pages.receiptsDuplicateWarning" />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {similarTransactions.map((transaction, idx) => (
                <div key={idx} className="p-3 border rounded-md bg-muted/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <p dir="auto" className="font-medium">
                        {transaction.merchant || t["screens.unknownMerchant"]}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {transaction.date ? formatDate(transaction.date, locale) : "—"}
                      </p>
                      {transaction.category && (
                        <Badge variant="outline" className="mt-1">
                          {transaction.category}
                        </Badge>
                      )}
                    </div>
                    <p className="font-semibold">
                      {formatCurrency(transaction.amount || 0, "AED", locale)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setSimilarWarningOpen(false);
                  setPendingSaveData(null);
                  setSimilarTransactions([]);
                }}
                className="flex-1"
                data-testid="button-cancel-similar-warning"
              >
                <T k="banking.common.cancel" />
              </Button>
              <Button
                onClick={async () => {
                  setSimilarWarningOpen(false);
                  if (pendingSaveData) {
                    await performSave(pendingSaveData);
                  }
                  setPendingSaveData(null);
                  setSimilarTransactions([]);
                }}
                className="flex-1"
                data-testid="button-save-anyway"
              >
                <T k="pageLabels.saveAnyway" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Account Dialog */}
      <Dialog open={createAccountDialogOpen} onOpenChange={setCreateAccountDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.createNewAccount" />
            </DialogTitle>
            <DialogDescription>
              Add a new {newAccountType === "expense" ? "expense" : "payment"} account
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-code">
                <T k="pageLabels.accountCode" />
              </Label>
              <Input
                id="account-code"
                value={newAccountCode}
                onChange={(e) => setNewAccountCode(e.target.value)}
                placeholder={tr("e.g., 5220", "مثال: 5220")}
                data-testid="input-account-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-name">
                <T k="pageLabels.accountName" />
              </Label>
              <Input
                id="account-name"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder={tr("e.g., Travel Expenses", "مثال: مصاريف السفر")}
                data-testid="input-account-name"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateAccountDialogOpen(false)}
                className="flex-1"
                disabled={createAccountMutation.isPending}
              >
                <T k="banking.common.cancel" />
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!newAccountCode.trim() || !newAccountName.trim()) {
                    toast({
                      variant: "destructive",
                      title: tr("Missing information", "معلومات ناقصة"),
                      description: tr(
                        "Please enter both account code and name.",
                        "يرجى إدخال رمز الحساب واسمه."
                      ),
                    });
                    return;
                  }
                  createAccountMutation.mutate({
                    code: newAccountCode.trim(),
                    nameEn: newAccountName.trim(),
                    nameAr: newAccountName.trim(),
                    type: newAccountType,
                    isActive: true,
                  });
                }}
                disabled={
                  createAccountMutation.isPending ||
                  !newAccountCode.trim() ||
                  !newAccountName.trim()
                }
                className="flex-1"
                data-testid="button-create-account-submit"
              >
                {createAccountMutation.isPending
                  ? t["pages.receiptsCreating"]
                  : t["pages.receiptsCreateAccount"]}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post Expense Dialog */}
      <Dialog open={postDialogOpen} onOpenChange={setPostDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.postExpenseToJournal" />
            </DialogTitle>
            <DialogDescription>
              <T k="pageLabels.selectAccountsToCreateJournalEntry" />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {postingReceipt && (
              <div className="p-4 rounded-md bg-muted">
                <div className="flex justify-between items-center">
                  <div>
                    <p dir="auto" className="font-medium">
                      {postingReceipt.merchant || t["screens.unknownMerchant"]}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {postingReceipt.date ? formatDate(postingReceipt.date, locale) : "—"}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="font-semibold text-lg">
                      {formatCurrency(
                        (postingReceipt.amount || 0) + (postingReceipt.vatAmount || 0),
                        "AED",
                        locale
                      )}
                    </p>
                    {/* X5 (J1 L6): the list shows the net amount; say how the total is made up. */}
                    {(postingReceipt.vatAmount || 0) > 0 && (
                      <p className="text-xs text-muted-foreground" data-testid="text-post-net-vat">
                        {formatMessage(t["pages.receiptsNetPlusVat"], {
                          net: formatCurrency(postingReceipt.amount || 0, "AED", locale),
                          vat: formatCurrency(postingReceipt.vatAmount || 0, "AED", locale),
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="expense-account">
                  {tr("Expense account (debit)", "حساب المصروف (مدين)")}
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNewAccountType("expense");
                    setCreateAccountDialogOpen(true);
                  }}
                  data-testid="button-create-expense-account"
                >
                  + {tr("Create", "إنشاء")}
                </Button>
              </div>
              <Select value={selectedExpenseAccount} onValueChange={setSelectedExpenseAccount}>
                <SelectTrigger id="expense-account" data-testid="select-expense-account">
                  <SelectValue placeholder={t["pages.receiptsSelectExpenseAccount"]} />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    ?.filter((acc) => acc.type === "expense")
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {accountDisplayName(account, locale)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "The account that will be debited (increased) for this expense",
                  "الحساب الذي سيُدين (يزداد) لهذا المصروف"
                )}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="payment-account">
                  {tr("Payment account (credit)", "حساب الدفع (دائن)")}
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNewAccountType("asset");
                    setCreateAccountDialogOpen(true);
                  }}
                  data-testid="button-create-payment-account"
                >
                  + {tr("Create", "إنشاء")}
                </Button>
              </div>
              <Select value={selectedPaymentAccount} onValueChange={setSelectedPaymentAccount}>
                <SelectTrigger id="payment-account" data-testid="select-payment-account">
                  <SelectValue placeholder={t["pages.receiptsSelectPaymentAccount"]} />
                </SelectTrigger>
                <SelectContent>
                  {/* X5 (J1 D1): only postable cash / bank accounts (no headers, no A/R). */}
                  {postablePaymentAccounts(accounts ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountDisplayName(account, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "The cash or bank account that was used to pay (will be credited/decreased)",
                  "الحساب النقدي أو البنكي المستخدم للدفع (سيُقيَّد دائناً/ينقص)"
                )}
              </p>
            </div>

            <div className="p-4 rounded-md border bg-card">
              <p className="text-sm font-medium mb-2">
                {tr("Journal entry preview", "معاينة قيد اليومية")}:
              </p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>
                    {tr("Dr.", "مدين")}{" "}
                    {accountLabel(accounts?.find((a) => a.id === selectedExpenseAccount)) ||
                      tr("Expense account", "حساب المصروف")}
                  </span>
                  <span>{formatCurrency(postingReceipt?.amount || 0, "AED", locale)}</span>
                </div>
                {(postingReceipt?.vatAmount || 0) > 0 && (
                  <div className="flex justify-between" data-testid="preview-input-vat">
                    <span>{t["pages.receiptsInputVatRecoverable"]}</span>
                    <span>{formatCurrency(postingReceipt?.vatAmount || 0, "AED", locale)}</span>
                  </div>
                )}
                <div className="flex justify-between ps-4">
                  <span>
                    {tr("Cr.", "دائن")}{" "}
                    {accountLabel(accounts?.find((a) => a.id === selectedPaymentAccount)) ||
                      tr("Payment account", "حساب الدفع")}
                  </span>
                  <span>
                    {formatCurrency(
                      (postingReceipt?.amount || 0) + (postingReceipt?.vatAmount || 0),
                      "AED",
                      locale
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPostDialogOpen(false)}
                className="flex-1"
                disabled={postExpenseMutation.isPending}
              >
                <T k="banking.common.cancel" />
              </Button>
              <Button
                type="button"
                onClick={submitPostExpense}
                disabled={
                  postExpenseMutation.isPending ||
                  !selectedExpenseAccount ||
                  !selectedPaymentAccount
                }
                className="flex-1"
                data-testid="button-submit-post-expense"
              >
                {postExpenseMutation.isPending
                  ? t["pages.receiptsPosting"]
                  : t["pages.receiptsPostToJournal"]}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Expense Entry Dialog */}
      <Dialog open={manualExpenseDialogOpen} onOpenChange={setManualExpenseDialogOpen}>
        <DialogContent size="md" data-testid="dialog-manual-expense">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.addExpenseManually" />
            </DialogTitle>
            <DialogDescription>
              <T k="pageLabels.enterExpenseDetailsWithoutOcrScanning" />
            </DialogDescription>
          </DialogHeader>
          <Form {...manualExpenseForm}>
            <form
              onSubmit={manualExpenseForm.handleSubmit(onManualExpenseSubmit)}
              noValidate
              className="space-y-6"
            >
              <FormErrorSummary />
              <FormSection title={t["forms.section.expense"]}>
                <FormGrid>
                  <FormField
                    control={manualExpenseForm.control}
                    name="merchant"
                    render={({ field }) => (
                      <FormItem className={formSpanFull}>
                        <FormLabel required>{t["forms.receipt.merchant"]}</FormLabel>
                        <FormControl>
                          <Input
                            dir="auto"
                            placeholder={t["forms.receipt.merchantPlaceholder"]}
                            {...field}
                            data-testid="input-manual-merchant"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={manualExpenseForm.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t.date}</FormLabel>
                        <FormControl>
                          <DatePicker
                            value={field.value}
                            onChange={field.onChange}
                            data-testid="input-manual-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={manualExpenseForm.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["forms.claim.category"]}</FormLabel>
                        <FormControl>
                          <Input
                            dir="auto"
                            placeholder={t["forms.receipt.categoryPlaceholder"]}
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-manual-category"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={manualExpenseForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["forms.claim.amountAed"]}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...field}
                            data-testid="input-manual-amount"
                          />
                        </FormControl>
                        <FormDescription>{t["forms.receipt.amountHelp"]}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={manualExpenseForm.control}
                    name="vatAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["screens.vatAmountAed"]}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-manual-vat"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>
              <FormActions sticky>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManualExpenseDialogOpen(false)}
                >
                  <T k="banking.common.cancel" />
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={manualExpenseMutation.isPending}
                  data-testid="button-submit-manual-expense"
                >
                  {manualExpenseMutation.isPending
                    ? t["forms.saving"]
                    : t["forms.receipt.createExpense"]}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
