import { useState, useCallback, useEffect, useMemo } from "react";
import { formatCalendarDate, todayYmd, uaeDayOf } from "@/lib/calendar-date";
import { accountName } from "@/lib/account-name";
import { CameraCapture } from "@/components/CameraCapture";
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
import { Skeleton } from "@/components/ui/skeleton";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { clearCsrfToken, withCsrfHeader } from "@/lib/csrf";
import { parseReceiptOcrText } from "@shared/receipt-ocr-parser";
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
  Image as ImageIcon,
  X,
  Trash2,
  RefreshCw,
  Edit,
  Download,
  FileSpreadsheet,
  ZoomIn,
  Brain,
  Bot,
  Zap,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SiGooglesheets } from "react-icons/si";
import { VirtualList } from "@/components/VirtualList";
import { formatCurrency } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { messages as pageMessages } from "./Receipts.i18n";

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
}

interface ProcessedReceipt {
  file: File;
  preview: string;
  status: "pending" | "processing" | "completed" | "saved" | "error" | "save_error";
  progress: number;
  data?: ExtractedData;
  error?: string;
}

function isOcrRetryable(receipt: ProcessedReceipt): boolean {
  return receipt.status === "pending" || receipt.status === "error";
}

const receiptSchema = z.object({
  merchant: z.string().min(1, pageMessages.marker("merchantNameIsRequired")),
  date: z.string().min(1, pageMessages.marker("dateIsRequired")),
  amount: z.coerce.number().min(0, pageMessages.marker("amountMustBePositive")),
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
  const tr = pageMessages.useT();

  const hasImage = !!(receipt.imagePath || receipt.imageData);
  const url = useReceiptImageUrl(companyId, receipt.id, hasImage);

  if (!hasImage) {
    return (
      <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center" aria-hidden>
        <FileText className="w-6 h-6" />
      </div>
    );
  }

  if (!url) {
    return (
      <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center" aria-hidden>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onPreview(url, receipt.merchant ?? undefined)}
      className="group relative w-12 h-12 rounded-md overflow-hidden border hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={tr("previewReceiptImageFor", { value: receipt.merchant ?? "this receipt" })}
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
const getClassifierMethodLabels = (): Record<string, string> => ({
  rule: "your company rules",
  keyword: pageMessages.t("uaeKeywordMatch"),
  statistical: "your past classifications",
  openai: pageMessages.t("aiVision"),
});

export default function Receipts() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  // Categories are stored as English ids; the label shown is in the interface language.
  const categoryLabel = (category: string | null | undefined): string => {
    const keys = {
      "Office Supplies": "officeSupplies",
      Meals: "mealsEntertainment",
      "Meals & Entertainment": "mealsEntertainment",
      Travel: "travel",
      Utilities: "utilities",
      Marketing: "marketing",
      Equipment: "equipment",
      Communication: "communication",
      "Professional Services": "professionalServices",
      Insurance: "insurance",
      Maintenance: "maintenance",
      Rent: "rent",
      Software: "software",
      Other: "other",
    } as const;
    const key = keys[(category ?? "") as keyof typeof keys];
    return key ? tr(key) : (category ?? "");
  };
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

  const manualExpenseForm = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      merchant: "",
      date: todayYmd(),
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
  const saveReceiptMutation = useMutation({
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
        title: tr("receiptUpdatedSuccessfully"),
        description: tr("yourReceiptHasBeenUpdated"),
      });
      setEditDialogOpen(false);
      setEditingReceipt(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateReceipt"),
        description: error?.message || tr("pleaseTryAgain"),
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
        title: tr("expensePostedSuccessfully"),
        description: tr("journalEntryHasBeenCreated"),
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
        title: tr("failedToPostExpense"),
        description: error?.message || tr("pleaseTryAgain"),
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
        status: "pending",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
      toast({
        title: tr("expenseCreatedSuccessfully"),
        description: tr("theExpenseHasBeenAddedYou"),
      });
      setManualExpenseDialogOpen(false);
      manualExpenseForm.reset();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateExpense"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/companies/${companyId}/accounts`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "accounts"] });
      toast({
        title: tr("accountCreatedSuccessfully"),
        description: tr("hasBeenAdded", { nameEn: data.nameEn }),
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
        title: tr("failedToCreateAccount"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const checkSimilarMutation = useMutation({
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
        title: tr("expenseDeleted"),
        description: tr("theExpenseHasBeenDeletedSuccessfully"),
      });
    },
    onError: (error: any, _id, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        variant: "destructive",
        title: tr("failedToDeleteExpense"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "receipts"] });
    },
  });

  const handleDeleteReceipt = (receipt: any) => {
    if (window.confirm(tr("areYouSureYouWantTo"))) {
      deleteMutation.mutate(receipt.id);
    }
  };

  const handleEditReceipt = (receipt: any) => {
    setEditingReceipt(receipt);
    form.reset({
      merchant: receipt.merchant || "",
      date: uaeDayOf(receipt.date),
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
    setSelectedPaymentAccount("");
    setPostDialogOpen(true);
  };

  const submitPostExpense = () => {
    if (!postingReceipt || !selectedExpenseAccount || !selectedPaymentAccount) {
      toast({
        variant: "destructive",
        title: tr("missingInformation"),
        description: tr("pleaseSelectBothExpenseAndPayment"),
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
            title: tr("invalidFile"),
            description: tr("mustBeAnImageOrPdf", { name: file.name }),
            variant: "destructive",
          });
          continue;
        }

        if (isPdf) {
          try {
            toast({
              title: tr("convertingPdf"),
              description: tr("readingAllPagesOf", { name: file.name }),
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
              title: tr("pdfReady"),
              description:
                rendered < total
                  ? tr("ofPagesAddedCappedAtEach", {
                      name: file.name,
                      rendered,
                      total,
                      MAX_PDF_PAGES,
                    })
                  : tr.plural("pdfPagesAdded", rendered, { name: file.name }),
            });
          } catch (error: any) {
            console.error("PDF conversion error:", error);
            toast({
              title: tr("pdfConversionFailed"),
              description: tr("couldNotConvertPleaseUploadAn", { name: file.name }),
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
                title: tr("couldnTReadThisPhoto"),
                description: tr("isInAFormatThisBrowser", { name: file.name }),
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
    [toast]
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

  const processReceipt = async (index: number) => {
    const receipt = processedReceipts[index];
    if (!receipt) return;

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
          return tr("ocrServiceIsTemporarilyUnavailablePlease");
        }
        if (message && /failed to fetch|load failed|networkerror/i.test(message)) {
          return tr("couldNotReachTheOcrService");
        }
        if (!message || /internal server error/i.test(message)) {
          return tr("ocrProcessingFailedPleaseTryAgain");
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
            // i18n-ignore: persisted data value, must not depend on the UI language
            merchant: result.merchant || "Unknown Merchant",
            date: result.date || todayYmd(),
            invoiceNumber: result.invoiceNumber || null,
            subtotal: result.subtotal || result.amount || 0,
            vatPercentage: result.vatPercentage ?? 5,
            vatAmount: result.vatAmount || 0,
            total: result.total || result.amount || 0,
            currency: result.currency || "AED",
            category: result.category || "Other",
            lineItems: result.lineItems || [],
            rawText: result.rawText || "",
            confidence: result.confidence ?? 0.85,
            // i18n-ignore: category id (matches the category select values)
            suggestedCategory: result.category || "Other",
            classifier: result.classifier || null,
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
            backendErrorMessage = normaliseOcrError(
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
              "OCR service is temporarily unavailable. Please try again in a moment."
          );
        }

        let tesseractText = "";
        try {
          const result = await Tesseract.recognize(receipt.file, "eng", {
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
          const tessMsg = tesseractError?.message || tr("tesseractFailedToInitialize");
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
          // i18n-ignore: persisted data value, must not depend on the UI language
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
        updated[index] = { ...updated[index], status: "completed", data: parsed!, progress: 100 };
        return updated;
      });
    } catch (error: any) {
      console.error("OCR processing error:", error);
      setProcessedReceipts((prev) => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          status: "error",
          error: error?.message || tr("ocrProcessingFailedTryAClearer"),
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

    setIsProcessingBulk(true);

    for (const index of indexesToProcess) {
      await processReceipt(index);
    }

    setIsProcessingBulk(false);
    toast({
      title: tr("processingComplete"),
      description: tr("processedReceiptS", { indexesToProcessCount: indexesToProcess.length }),
    });
  };

  const parseReceiptText = (text: string): ExtractedData => {
    return parseReceiptOcrText(text);
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
    const completedIndices = processedReceipts
      .map((r, i) => ({ receipt: r, index: i }))
      .filter(({ receipt }) => receipt.status === "completed" && receipt.data);

    if (completedIndices.length === 0) {
      toast({
        title: tr("noReceiptsToSave"),
        description: tr("pleaseProcessReceiptsBeforeSaving"),
        variant: "destructive",
      });
      return;
    }

    if (!companyId) {
      toast({
        title: tr("error"),
        description: tr("companyNotFoundPleaseTryRefreshing"),
        variant: "destructive",
      });
      return;
    }

    // Proceed with save directly - similar check removed for better UX
    await performSave(completedIndices);
  };

  const performSave = async (completedIndices: any[]) => {
    if (!companyId) {
      toast({
        title: tr("error"),
        description: tr("companyNotFoundPleaseTryRefreshing"),
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
        const receiptData = {
          companyId: companyId,
          // i18n-ignore: persisted data value, must not depend on the UI language
          merchant: receipt.data!.merchant || "Unknown",
          date: receipt.data!.date || todayYmd(),
          invoiceNumber: receipt.data!.invoiceNumber || null,
          amount: Number(receipt.data!.subtotal ?? receipt.data!.total) || 0,
          vatAmount: receipt.data!.vatAmount ? Number(receipt.data!.vatAmount) : null,
          vatPercentage: receipt.data!.vatPercentage ?? 5,
          total: Number(receipt.data!.total) || 0,
          category: receipt.data!.category || "Uncategorized",
          currency: receipt.data!.currency || "AED",
          imageData: receipt.preview,
          rawText: receipt.data!.rawText,
          lineItems: receipt.data!.lineItems || [],
          suggestedCategory: receipt.data!.suggestedCategory ?? null,
          classifierMethod: receipt.data!.classifier?.method ?? null,
          classifierConfidence: receipt.data!.classifier?.confidence ?? null,
          classifierReason: receipt.data!.classifier?.reason ?? null,
        };

        await apiRequest("POST", `/api/companies/${companyId}/receipts`, receiptData);

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
        const errorMessage = error?.message || tr("failedToSaveToDatabase");
        if (!firstSaveError) firstSaveError = errorMessage;

        // Mark this receipt as failed to save
        setProcessedReceipts((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            status: "save_error",
            error: errorMessage,
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
        title: tr("receiptsSaved"),
        description:
          tr.plural("receiptsSavedCount", successCount) +
          (errorCount > 0 ? ` ${tr("receiptsSaveFailedSuffix", { errorCount })}` : ""),
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
        title: tr("saveFailed"),
        description: firstSaveError
          ? tr("couldnTSave", { firstSaveError })
          : tr("failedToSaveAnyReceiptsPlease"),
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
      toast({ variant: "destructive", title: tr("noData"), description: tr("noExpensesToExport") });
      return;
    }

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    exportToExcel([prepareReceiptsForExport(filteredReceipts, locale)], `expenses${dateRangeStr}`);
    toast({
      title: tr("exportSuccessful"),
      description: tr("expensesExportedToExcel", {
        filteredReceiptsCount: filteredReceipts.length,
      }),
    });
  };

  const handleExportGoogleSheets = async () => {
    if (!companyId || !filteredReceipts.length) {
      toast({ variant: "destructive", title: tr("noData"), description: tr("noExpensesToExport") });
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
        title: tr("exportSuccessful"),
        description: tr("expensesExportedToGoogleSheets", {
          filteredReceiptsCount: filteredReceipts.length,
        }),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: result.error || tr("failedToExportToGoogleSheets"),
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
        title: tr("nothingToExport"),
        description: tr("processAtLeastOneReceiptBefore"),
      });
      return;
    }

    setIsOcrExporting(true);
    try {
      await downloadOcrExcel(rows);
      toast({
        title: tr("excelReady"),
        description: tr.plural("receiptsExportedToExcel", rows.length),
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: err?.message || tr("couldNotGenerateTheSpreadsheet"),
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
      toast({ variant: "destructive", title: tr("noData"), description: tr("noExpensesToExport") });
      return;
    }
    setIsExporting(true);
    try {
      await downloadReceiptsExcel(companyId, {
        ids: filteredReceipts.map((r: any) => r.id),
      });
      toast({
        title: tr("excelReady"),
        description: tr("receiptsExported", { filteredReceiptsCount: filteredReceipts.length }),
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: err?.message || tr("couldNotGenerateTheSpreadsheet"),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("purchases")}
        title={t.receiptScanner}
        description={(t as any).receiptScannerSubtitle ?? tr("uploadReceiptsForAiExtractionOr")}
        actions={
          <Button
            onClick={() => setManualExpenseDialogOpen(true)}
            className="w-full sm:w-auto"
            data-testid="button-add-manual-expense"
          >
            <Plus className="w-4 h-4 me-2" />
            {tr("addExpenseManually")}
          </Button>
        }
      />

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            {tr("uploadReceipts")}
          </CardTitle>
          <CardDescription>{tr("dragDropReceiptImagesOrClick")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center transition-all
              ${isDragging ? "border-primary bg-primary/5" : "border-border"}
              ${processedReceipts.length > 0 ? "border-[hsl(var(--chart-5))] bg-[hsl(var(--chart-5)/0.05)]" : ""}
              hover:border-primary hover:bg-accent/50 cursor-pointer
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
              aria-label={tr("uploadReceiptImagesOrPdfs")}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) handleFilesSelect(files);
              }}
              data-testid="input-file"
            />

            {processedReceipts.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2 text-[hsl(var(--chart-5))]">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>
                    {tr("imageSLoaded", { processedReceiptsCount: processedReceipts.length })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{tr("clickOrDropMoreImagesTo")}</p>
                <CameraCapture onCapture={handleFilesSelect} />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Camera className="w-8 h-8 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="text-lg font-medium">{tr("dropYourReceiptsHere")}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {tr("orClickToBrowseFilesMultiple")}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{tr("supportsJpgPngHeicPdfBulk")}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    document.getElementById("file-input")?.click();
                  }}
                  data-testid="button-browse-receipts"
                >
                  {tr("browseFiles")}
                </Button>
                <CameraCapture onCapture={handleFilesSelect} />
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
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    {tr("processing")}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 me-2" />
                    {errorCount > 0 && pendingCount === 0
                      ? tr("retryFailedOcr", { errorCount })
                      : errorCount > 0
                        ? tr("processRetryOcr", { retryableOcrCount })
                        : tr("processAllReceipts", { pendingCount })}
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
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    {tr("saving", { savedCount, totalToSave })}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 me-2" />
                    {tr("saveAll", { completedCount })}
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
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    {tr("preparing")}
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4 me-2" />
                    {tr("downloadExcel", { completedCount })}
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
                <Badge variant="outline">{tr("pending", { pendingCount })}</Badge>
              )}
              {processingCount > 0 && (
                <Badge variant="outline">{tr("processing2", { processingCount })}</Badge>
              )}
              {completedCount > 0 && (
                <StatusBadge tone="success">{tr("readyToSave", { completedCount })}</StatusBadge>
              )}
              {savedCount > 0 && (
                <StatusBadge tone="info">{tr("saved", { savedCount })}</StatusBadge>
              )}
              {errorCount > 0 && (
                <StatusBadge tone="danger">{tr("ocrErrors", { errorCount })}</StatusBadge>
              )}
              {saveErrorCount > 0 && (
                <StatusBadge tone="warning">{tr("saveFailed2", { saveErrorCount })}</StatusBadge>
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
                        setImagePreview({ src: receipt.preview, merchant: receipt.data?.merchant })
                      }
                      className="group relative block w-24 h-24 rounded-lg overflow-hidden border hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={tr("previewSourceImage")}
                      data-testid={`ocr-thumbnail-${index}`}
                    >
                      <img
                        src={receipt.preview}
                        alt={tr("receipt", { value: index + 1 })}
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
                        <Badge variant="outline">{tr("pending2")}</Badge>
                        <p className="text-sm text-muted-foreground">{tr("readyToProcess")}</p>
                      </div>
                    )}

                    {receipt.status === "processing" && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {tr("processingWithOcr")}
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
                          <RefreshCw className="w-3 h-3 me-1" />
                          {tr("tryAgain")}
                        </Button>
                      </div>
                    )}

                    {receipt.status === "saved" && (
                      <div className="flex items-center gap-2 text-[hsl(var(--chart-1))]">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">
                          {tr("successfullySavedToDatabase")}
                        </span>
                      </div>
                    )}

                    {receipt.status === "save_error" && (
                      <div className="flex items-center gap-2 text-[hsl(var(--chart-4))]">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">{receipt.error || tr("failedToSave")}</span>
                      </div>
                    )}

                    {receipt.status === "completed" && receipt.data && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">{tr("merchantSupplier")}</Label>
                          <Input
                            value={receipt.data.merchant || ""}
                            onChange={(e) => updateReceiptData(index, { merchant: e.target.value })}
                            className="h-8"
                            data-testid={`input-merchant-${index}`}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">{tr("date")}</Label>
                          <Input
                            type="date"
                            value={uaeDayOf(receipt.data.date)}
                            onChange={(e) => updateReceiptData(index, { date: e.target.value })}
                            className="h-8"
                            data-testid={`input-date-${index}`}
                          />
                        </div>

                        {receipt.data.invoiceNumber && (
                          <div className="space-y-1 col-span-2">
                            <Label className="text-xs">{tr("invoiceReceiptNumber")}</Label>
                            <Input
                              value={receipt.data.invoiceNumber || ""}
                              onChange={(e) =>
                                updateReceiptData(index, { invoiceNumber: e.target.value })
                              }
                              className="h-8 font-mono"
                            />
                          </div>
                        )}

                        <div className="space-y-1">
                          <Label className="text-xs">{tr("subtotalExclVat")}</Label>
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
                            {tr("vat")}
                            {receipt.data.vatPercentage ?? 5}%)
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={receipt.data.vatAmount ?? ""}
                            onChange={(e) =>
                              updateReceiptData(index, { vatAmount: parseFloat(e.target.value) })
                            }
                            className="h-8"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-semibold">{tr("totalInclVat")}</Label>
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
                          <Label className="text-xs">{tr("category")}</Label>
                          <Select
                            value={receipt.data.category}
                            onValueChange={(value) => updateReceiptData(index, { category: value })}
                          >
                            <SelectTrigger className="h-8" data-testid={`select-category-${index}`}>
                              <SelectValue placeholder={tr("category")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Office Supplies">
                                {tr("officeSupplies")}
                              </SelectItem>
                              <SelectItem value="Meals">{tr("mealsEntertainment")}</SelectItem>
                              <SelectItem value="Travel">{tr("travel")}</SelectItem>
                              <SelectItem value="Utilities">{tr("utilities")}</SelectItem>
                              <SelectItem value="Marketing">{tr("marketing")}</SelectItem>
                              <SelectItem value="Equipment">{tr("equipment")}</SelectItem>
                              <SelectItem value="Communication">{tr("communication")}</SelectItem>
                              <SelectItem value="Professional Services">
                                {tr("professionalServices")}
                              </SelectItem>
                              <SelectItem value="Insurance">{tr("insurance")}</SelectItem>
                              <SelectItem value="Maintenance">{tr("maintenance")}</SelectItem>
                              <SelectItem value="Rent">{tr("rent")}</SelectItem>
                              <SelectItem value="Other">{tr("other")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {receipt.data.lineItems && receipt.data.lineItems.length > 0 && (
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">{tr("lineItems")}</Label>
                            <div className="rounded border text-xs divide-y">
                              {receipt.data.lineItems.map((item, i) => (
                                <div key={i} className="flex justify-between px-2 py-1">
                                  <span className="truncate max-w-[60%]">{item.description}</span>
                                  <span className="text-muted-foreground ms-2">
                                    {item.quantity > 1 ? `×${item.quantity}  ` : ""}
                                    {item.total.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {receipt.data.confidence && (
                          <div className="col-span-2">
                            <p className="text-xs text-muted-foreground">
                              {tr("aiConfidence", {
                                round: Math.round(receipt.data.confidence * 100),
                              })}
                              <Badge variant="secondary" className="ms-2">
                                <Sparkles className="w-2 h-2 me-1" />
                                {tr("gpt4oVision")}
                              </Badge>
                            </p>
                          </div>
                        )}

                        {receipt.data.classifier?.method && (
                          <div className="col-span-2">
                            <p
                              className="text-xs text-muted-foreground"
                              data-testid={`text-classifier-why-${index}`}
                              title={receipt.data.classifier.reason || undefined}
                            >
                              {tr("categorySuggestedBy")}
                              <span className="font-medium text-foreground">
                                {getClassifierMethodLabels()[receipt.data.classifier.method] ??
                                  receipt.data.classifier.method}
                              </span>
                              {typeof receipt.data.classifier.confidence === "number" && (
                                <>
                                  {" "}
                                  {tr("confident", {
                                    round: Math.round(receipt.data.classifier.confidence * 100),
                                  })}
                                </>
                              )}
                              {tr("youCanChangeItAboveYour")}
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>{tr("recentExpenses")}</CardTitle>
              <CardDescription>{tr("previouslyScannedAndSavedExpenses")}</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={isExporting}
                  data-testid="button-export-expenses"
                >
                  <Download className="w-4 h-4 me-2" />
                  {isExporting ? tr("exporting") : tr("export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={handleExportExcel}
                  data-testid="menu-export-expenses-excel"
                >
                  <FileSpreadsheet className="w-4 h-4 me-2" />
                  {tr("exportToExcelFull")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleDownloadReceiptsExcel}
                  data-testid="menu-export-expenses-excel-ocr"
                >
                  <FileSpreadsheet className="w-4 h-4 me-2" />
                  {tr("downloadExcelOcrFormat")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExportGoogleSheets}
                  data-testid="menu-export-expenses-sheets"
                >
                  <SiGooglesheets className="w-4 h-4 me-2" />
                  {tr("exportToGoogleSheets")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap pb-4 border-b">
            <span className="text-sm font-medium">{tr("filterByDate")}</span>
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
          </div>
          {isLoading ? (
            <CardListSkeleton count={4} />
          ) : filteredReceipts && filteredReceipts.length > 0 ? (
            <VirtualList
              items={filteredReceipts as any[]}
              estimateSize={88}
              height={Math.min(720, Math.max(400, filteredReceipts.length * 88))}
              getKey={(receipt) => receipt.id}
              className="space-y-2"
              renderItem={(receipt: any) => (
                <div
                  key={receipt.id}
                  className="flex flex-col gap-3 p-4 border rounded-lg hover-elevate mb-2 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`receipt-${receipt.id}`}
                >
                  <div className="flex items-center gap-4">
                    <ReceiptThumbnail
                      companyId={companyId}
                      receipt={receipt}
                      onPreview={(src, merchant) => setImagePreview({ src, merchant })}
                    />
                    <div>
                      <p className="font-medium">{receipt.merchant || tr("unknownMerchant")}</p>
                      <p className="text-sm text-muted-foreground">{formatCalendarDate(receipt.date, locale)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="text-start sm:text-end">
                      <p dir="ltr" className="font-mono font-semibold">
                        {formatCurrency(receipt.amount || 0, "AED", locale)}
                      </p>
                      <div className="flex gap-2 mt-1 flex-wrap sm:justify-end">
                        <Badge variant="outline">{receipt.category ? categoryLabel(receipt.category) : tr("uncategorized")}</Badge>
                        {isInternalClassifierMethod(receipt.classifierMethod) && (
                          <Badge
                            variant="secondary"
                            className="bg-info/10 text-info border-info/30"
                            data-testid={`badge-classifier-internal-${receipt.id}`}
                            title={tr("classifiedByInternalStage", {
                              classifierMethod: receipt.classifierMethod,
                            })}
                          >
                            <Brain className="w-3 h-3 me-1" />
                            {tr("internal")}
                          </Badge>
                        )}
                        {receipt.classifierMethod === "openai" && (
                          <Badge
                            variant="secondary"
                            className="bg-chart-5/10 text-chart-5 border-chart-5/30"
                            data-testid={`badge-classifier-ai-${receipt.id}`}
                            title={tr("classifiedByOpenaiFallback")}
                          >
                            <Bot className="w-3 h-3 me-1" />
                            {tr("ai")}
                          </Badge>
                        )}
                        {receipt.autoPosted && (
                          <Badge
                            variant="default"
                            className="bg-success hover:bg-success"
                            data-testid={`badge-auto-posted-${receipt.id}`}
                            title={tr("autoPostedByReceiptAutopilot")}
                          >
                            <Zap className="w-3 h-3 me-1" />
                            {tr("autoPosted")}
                          </Badge>
                        )}
                        {receipt.posted && !receipt.autoPosted && (
                          <StatusBadge tone="success">{tr("posted")}</StatusBadge>
                        )}
                      </div>
                    </div>
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                      {!receipt.posted && (
                        <Button
                          variant="default"
                          size="sm"
                          className="flex-1 sm:flex-none"
                          onClick={() => handlePostExpense(receipt)}
                          data-testid={`button-post-receipt-${receipt.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 me-2" />
                          {tr("post")}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        onClick={() => handleEditReceipt(receipt)}
                        data-testid={`button-edit-receipt-${receipt.id}`}
                      >
                        <Edit className="w-4 h-4 me-2" />
                        {tr("edit")}
                      </Button>
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        data-testid={`button-proof-receipt-${receipt.id}`}
                      >
                        <Link href={evidenceSourceHref("receipt", receipt.id)}>
                          <FileText className="w-4 h-4 me-2" />
                          {tr("proof")}
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 sm:flex-none"
                        onClick={() => handleDeleteReceipt(receipt)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-receipt-${receipt.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            />
          ) : (
            <EmptyState
              icon={Upload}
              title={
                dateRange.from || dateRange.to
                  ? tr("noReceiptsInThisDateRange")
                  : tr("noReceiptsYet")
              }
              description={
                dateRange.from || dateRange.to
                  ? tr("tryWideningTheFilterOrClearing")
                  : tr("snapAPhotoOrUploadA")
              }
              action={
                !(dateRange.from || dateRange.to)
                  ? {
                      label: tr("uploadReceipt"),
                      icon: Upload,
                      onClick: () => document.getElementById("file-input")?.click(),
                      testId: "button-upload-first-receipt",
                    }
                  : undefined
              }
              secondaryAction={
                dateRange.from || dateRange.to
                  ? {
                      label: tr("clearFilter"),
                      onClick: () => setDateRange({ from: undefined, to: undefined }),
                    }
                  : undefined
              }
              testId="empty-state-receipts"
            />
          )}
        </CardContent>
      </Card>

      {/* Source Image Preview Dialog — lets users compare OCR output against the original. */}
      <Dialog open={!!imagePreview} onOpenChange={(open) => !open && setImagePreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{tr("sourceReceiptImage")}</DialogTitle>
            <DialogDescription>
              {imagePreview?.merchant
                ? tr("originalScannedImageFor", { merchant: imagePreview.merchant })
                : tr("originalScannedImage")}
            </DialogDescription>
          </DialogHeader>
          {imagePreview && (
            <div className="flex items-center justify-center bg-muted/30 rounded-md p-2 max-h-[75vh] overflow-auto">
              <img
                src={imagePreview.src}
                alt={tr("sourceReceipt")}
                className="max-w-full h-auto rounded"
                data-testid="image-preview-full"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Receipt Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("editReceipt")}</DialogTitle>
            <DialogDescription>{tr("updateReceiptDetails")}</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="merchant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("merchant")}</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-merchant" />
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
                    <FormLabel>{tr("date")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-edit-date" />
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
                    <FormLabel>{tr("amountBeforeVat")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        className="font-mono"
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
                    <FormLabel>{tr("vatAmountOptional")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.01"
                        className="font-mono"
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
                    <FormLabel>{tr("category")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-category">
                          <SelectValue placeholder={tr("selectCategory")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Office Supplies">{tr("officeSupplies")}</SelectItem>
                        <SelectItem value="Meals & Entertainment">
                          {tr("mealsEntertainment")}
                        </SelectItem>
                        <SelectItem value="Travel">{tr("travel")}</SelectItem>
                        <SelectItem value="Utilities">{tr("utilities")}</SelectItem>
                        <SelectItem value="Marketing">{tr("marketing")}</SelectItem>
                        <SelectItem value="Software">{tr("software")}</SelectItem>
                        <SelectItem value="Other">{tr("other")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditDialogOpen(false)}
                  className="flex-1"
                >
                  {tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={editMutation.isPending}
                  className="flex-1"
                  data-testid="button-submit-edit-receipt"
                >
                  {editMutation.isPending ? tr("saving2") : tr("save")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Similar Transactions Warning Dialog */}
      <Dialog open={similarWarningOpen} onOpenChange={setSimilarWarningOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-[hsl(var(--chart-4))]" />
              {tr("similarTransactionsFound")}
            </DialogTitle>
            <DialogDescription>{tr("weFoundSimilarTransactionsThatMight")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {similarTransactions.map((transaction, idx) => (
                <div key={idx} className="p-3 border rounded-md bg-muted/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{transaction.merchant || tr("unknownMerchant")}</p>
                      <p className="text-sm text-muted-foreground">{formatCalendarDate(transaction.date, locale)}</p>
                      {transaction.category && (
                        <Badge variant="outline" className="mt-1">
                          {categoryLabel(transaction.category)}
                        </Badge>
                      )}
                    </div>
                    <p dir="ltr" className="font-mono font-semibold">
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
                {tr("cancel")}
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
                {tr("saveAnyway")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Account Dialog */}
      <Dialog open={createAccountDialogOpen} onOpenChange={setCreateAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("createNewAccount")}</DialogTitle>
            <DialogDescription>
              {tr("addANew")} {newAccountType === "expense" ? tr("expense") : tr("payment")}{" "}
              {tr("account")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-code">{tr("accountCode")}</Label>
              <Input
                id="account-code"
                value={newAccountCode}
                onChange={(e) => setNewAccountCode(e.target.value)}
                placeholder="e.g., 5220"
                data-testid="input-account-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-name">{tr("accountName")}</Label>
              <Input
                id="account-name"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder={tr("eGTravelExpenses")}
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
                {tr("cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!newAccountCode.trim() || !newAccountName.trim()) {
                    toast({
                      variant: "destructive",
                      title: tr("missingInformation"),
                      description: tr("pleaseEnterBothAccountCodeAnd"),
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
                {createAccountMutation.isPending ? tr("creating") : tr("createAccount")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post Expense Dialog */}
      <Dialog open={postDialogOpen} onOpenChange={setPostDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("postExpenseToJournal")}</DialogTitle>
            <DialogDescription>{tr("selectAccountsToCreateJournalEntry")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {postingReceipt && (
              <div className="p-4 rounded-md bg-muted">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">
                      {postingReceipt.merchant || tr("unknownMerchant")}
                    </p>
                    <p className="text-sm text-muted-foreground">{formatCalendarDate(postingReceipt.date, locale)}</p>
                  </div>
                  <p dir="ltr" className="font-mono font-semibold text-lg">
                    {formatCurrency(
                      (postingReceipt.amount || 0) + (postingReceipt.vatAmount || 0),
                      "AED",
                      locale
                    )}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="expense-account">{tr("expenseAccountDebit")}</Label>
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
                  {tr("create")}
                </Button>
              </div>
              <Select value={selectedExpenseAccount} onValueChange={setSelectedExpenseAccount}>
                <SelectTrigger id="expense-account" data-testid="select-expense-account">
                  <SelectValue placeholder={tr("selectExpenseAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    ?.filter((acc) => acc.type === "expense")
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {locale === "ar" && account.nameAr ? account.nameAr : account.nameEn}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tr("theAccountThatWillBeDebited")}</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="payment-account">{tr("paymentAccountCredit")}</Label>
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
                  {tr("create")}
                </Button>
              </div>
              <Select value={selectedPaymentAccount} onValueChange={setSelectedPaymentAccount}>
                <SelectTrigger id="payment-account" data-testid="select-payment-account">
                  <SelectValue placeholder={tr("selectPaymentAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    ?.filter((acc) => acc.type === "asset")
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {locale === "ar" && account.nameAr ? account.nameAr : account.nameEn}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tr("theCashOrBankAccountThat")}</p>
            </div>

            <div className="p-4 rounded-md border bg-card">
              <p className="text-sm font-medium mb-2">{tr("journalEntryPreview")}</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>
                    {tr("dr")}
                    {accountName(accounts?.find((a) => a.id === selectedExpenseAccount), locale) ||
                      tr("expenseAccount")}
                  </span>
                  <span>
                    {formatCurrency(
                      (postingReceipt?.amount || 0) + (postingReceipt?.vatAmount || 0),
                      "AED",
                      locale
                    )}
                  </span>
                </div>
                <div className="flex justify-between ps-4">
                  <span>
                    {tr("cr")}
                    {accountName(accounts?.find((a) => a.id === selectedPaymentAccount), locale) ||
                      tr("paymentAccount")}
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
                {tr("cancel")}
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
                {postExpenseMutation.isPending ? tr("posting") : tr("postToJournal")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Expense Entry Dialog */}
      <Dialog open={manualExpenseDialogOpen} onOpenChange={setManualExpenseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("addExpenseManually")}</DialogTitle>
            <DialogDescription>{tr("enterExpenseDetailsWithoutOcrScanning")}</DialogDescription>
          </DialogHeader>
          <Form {...manualExpenseForm}>
            <form
              onSubmit={manualExpenseForm.handleSubmit(onManualExpenseSubmit)}
              className="space-y-4"
            >
              <FormField
                control={manualExpenseForm.control}
                name="merchant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("merchantVendor")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tr("eGOfficeDepot")}
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
                    <FormLabel>{tr("date")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-manual-date" />
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
                    <FormLabel>{tr("amountBeforeVat")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-manual-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={manualExpenseForm.control}
                name="vatAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("vatAmountOptional")}</FormLabel>
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
              <FormField
                control={manualExpenseForm.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("categoryOptional")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tr("eGOfficeSupplies")}
                        {...field}
                        value={field.value ?? ""}
                        data-testid="input-manual-category"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManualExpenseDialogOpen(false)}
                  className="flex-1"
                >
                  {tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={manualExpenseMutation.isPending}
                  className="flex-1"
                  data-testid="button-submit-manual-expense"
                >
                  {manualExpenseMutation.isPending ? tr("creating") : tr("createExpense")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
