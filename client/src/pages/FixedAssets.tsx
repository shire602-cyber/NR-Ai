import { T } from "@/components/layout/T";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  Calculator,
  Ban,
  DollarSign,
  TrendingDown,
  BarChart3,
  PlayCircle,
  Search,
  Download,
  BookCheck,
  WifiOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { TableSkeleton, StatCardSkeleton } from "@/components/ui/loading-skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { errorHeading } from "@/lib/error-heading";
import { depreciationPeriodEnded, lastEndedMonth } from "@/lib/depreciation-period";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { DataTableCard } from "@/components/ui/data-table";
import { matchesAssetSearch } from "@/lib/fixed-asset-search";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/format";
import { accountDisplayName } from "@/lib/account-name";
import { parseCalendarDate } from "@/lib/format-date";

// ─── Types ───────────────────────────────────────────────

interface FixedAsset {
  id: string;
  company_id: string;
  asset_name: string;
  asset_name_ar: string | null;
  asset_number: string | null;
  category: string;
  purchase_date: string;
  purchase_cost: string;
  salvage_value: string;
  useful_life_years: number | null;
  needs_capitalization_je?: boolean;
  capitalization_entry_id?: string | null;
  depreciation_method: string;
  accumulated_depreciation: string;
  net_book_value: string;
  location: string | null;
  serial_number: string | null;
  status: string;
  disposal_date: string | null;
  disposal_amount: string | null;
  notes: string | null;
  created_at: string;
}

interface AssetSummary {
  totalAssets: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  byCategory: {
    category: string;
    count: number;
    totalCost: number;
    totalAccumulatedDepreciation: number;
    totalNetBookValue: number;
  }[];
}

// ─── Schemas ─────────────────────────────────────────────

const CATEGORIES = [
  "Vehicles",
  "Furniture",
  "Equipment",
  "Electronics",
  "Building",
  "Land",
  "Other",
] as const;

const assetFormSchema = z
  .object({
    assetName: z.string().min(1, "forms.errors.assetNameRequired"),
    assetNameAr: z.string().optional().nullable(),
    assetNumber: z.string().optional().nullable(),
    category: z.string().min(1, "forms.errors.categoryRequired"),
    purchaseDate: z.string().min(1, "forms.errors.purchaseDateRequired"),
    purchaseCost: z.coerce.number().min(0, "forms.errors.purchaseCostNonNegative"),
    salvageValue: z.coerce
      .number()
      .min(0, "forms.errors.salvageValueNonNegative")
      .optional()
      .nullable(),
    // Land (IAS 16) has no useful life; every other category needs one.
    usefulLifeYears: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce.number().int().min(1, "forms.errors.usefulLifeMin1").nullable()
    ),
    depreciationMethod: z.enum(["straight_line", "declining_balance"]).optional().nullable(),
    location: z.string().optional().nullable(),
    serialNumber: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    paymentAccountId: z.string().optional().nullable(),
    /** X4 (J3): recoverable input VAT paid with the asset (Dr 1050, VAT 201 Box 9). */
    inputVat: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce.number().min(0, "forms.errors.vatAmountNonNegative").nullable()
    ),
  })
  .refine((v) => v.category.trim().toLowerCase() === "land" || !!v.usefulLifeYears, {
    message: "forms.errors.usefulLifeRequired",
    path: ["usefulLifeYears"],
  });

type AssetFormData = z.infer<typeof assetFormSchema>;

const disposeFormSchema = z.object({
  disposalDate: z.string().min(1, "forms.errors.disposalDateRequired"),
  disposalAmount: z.coerce.number().min(0, "forms.errors.disposalAmountNonNegative"),
  proceedsAccountId: z.string().optional().nullable(),
  onCredit: z.boolean().optional(),
  buyerName: z.string().optional().nullable(),
  vatTreatment: z.enum(["standard", "zero_rated", "exempt", "out_of_scope"]).optional(),
  notes: z.string().optional().nullable(),
});

type DisposeFormData = z.infer<typeof disposeFormSchema>;

// E2 (J3-r2): a month is depreciated only after it has ended (the entry is dated at month end).
const depreciationRunSchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
  })
  .refine((v) => depreciationPeriodEnded(v.year, v.month), {
    path: ["month"],
    message: "forms.errors.depreciationMonthNotEnded",
  });

type DepreciationRunData = z.infer<typeof depreciationRunSchema>;

// ─── Component ───────────────────────────────────────────

export default function FixedAssets() {
  const { t, locale } = useTranslation();
  const fa = FA_COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  // E2 (J4-r2): a viewer is not offered writes the server refuses (403).
  const { gate, can } = useCompanyPermission();

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FixedAsset | null>(null);
  const [disposeDialogOpen, setDisposeDialogOpen] = useState(false);
  const [disposingAsset, setDisposingAsset] = useState<FixedAsset | null>(null);
  const [depRunDialogOpen, setDepRunDialogOpen] = useState(false);
  // E3 (J3-r3): the row Capitalise action asks where it was paid from and the input VAT.
  const [capitalizeTarget, setCapitalizeTarget] = useState<FixedAsset | null>(null);
  const [capPaidFrom, setCapPaidFrom] = useState("");
  const [capInputVat, setCapInputVat] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────

  const {
    data: assetsData,
    isLoading: isLoadingAssets,
    isLoadingError: showAssetsError,
    isPaused: assetsPaused,
    refetch: refetchAssets,
  } = useQuery<FixedAsset[]>({
    queryKey: [`/api/companies/${companyId}/fixed-assets`],
    enabled: !!companyId,
  });
  const assets = assetsData ?? [];

  // isLoadingError: only a first load with nothing cached; a failed refresh keeps the cache.
  const {
    data: summary,
    isLoadingError: summaryLoadFailed,
    refetch: refetchSummary,
  } = useQuery<AssetSummary>({
    queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
    enabled: !!companyId,
  });
  const categories = summary?.byCategory ?? [];

  // ─── Forms ──────────────────────────────────────────────

  const assetForm = useForm<AssetFormData>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      assetName: "",
      assetNameAr: "",
      assetNumber: "",
      category: "",
      purchaseDate: "",
      purchaseCost: 0,
      salvageValue: 0,
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
      location: "",
      serialNumber: "",
      notes: "",
    },
  });

  const disposeForm = useForm<DisposeFormData>({
    resolver: zodResolver(disposeFormSchema),
    defaultValues: {
      disposalDate: "",
      disposalAmount: 0,
      notes: "",
    },
  });

  const assetCategory = useWatch({ control: assetForm.control, name: "category" });
  const disposeOnCredit = useWatch({ control: disposeForm.control, name: "onCredit" });

  const depRunForm = useForm<DepreciationRunData>({
    resolver: zodResolver(depreciationRunSchema),
    defaultValues: lastEndedMonth(),
  });
  // E2 (J3-r2): the row "Record depreciation" opens the same dialog for one asset.
  const [depAsset, setDepAsset] = useState<FixedAsset | null>(null);

  // ─── Mutations ──────────────────────────────────────────

  const { data: accountsList = [] } = useQuery<LedgerAccount[]>({
    queryKey: [`/api/companies/${companyId}/accounts`],
    enabled: !!companyId,
  });
  // E3 (J3-r3): a header account with sub-accounts (1020 Bank Accounts over 1021) is not offered.
  const parentAccountIds = new Set(
    accountsList.map((a) => (a as { parentId?: string | null }).parentId).filter(Boolean)
  );
  const cashAccounts = accountsList.filter(
    (a) =>
      a.type === "asset" &&
      !parentAccountIds.has(a.id) &&
      (a.code === "1010" || a.code === "1020" || /cash|bank/i.test(a.subType ?? ""))
  );

  const capitalizeMutation = useMutation({
    mutationFn: ({
      id,
      paymentAccountId,
      inputVat,
    }: {
      id: string;
      paymentAccountId: string;
      inputVat?: number;
    }) =>
      apiRequest("POST", `/api/fixed-assets/${id}/capitalize`, {
        paymentAccountId,
        ...(inputVat && inputVat > 0 ? { inputVat } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      setCapitalizeTarget(null);
      toast({ title: fa.capitalized });
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const createAssetMutation = useMutation({
    mutationFn: (data: AssetFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/fixed-assets`, {
        ...(({ inputVat: _vat, ...rest }) => rest)(data),
        usefulLifeYears: data.usefulLifeYears || null,
        paymentAccountId: data.paymentAccountId || null,
        ...(data.paymentAccountId && data.inputVat && data.inputVat > 0
          ? { inputVat: data.inputVat }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: translateNow("toasts.assetCreated"),
        description: translateNow("toasts.theFixedAssetHasBeenAddedSuccessfully"),
      });
      setAssetDialogOpen(false);
      assetForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AssetFormData> }) => {
      const { paymentAccountId: _p, inputVat: _v, ...rest } = data;
      return apiRequest("PATCH", `/api/fixed-assets/${id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: translateNow("toasts.assetUpdated"),
        description: translateNow("toasts.theFixedAssetHasBeenUpdatedSuccessfully"),
      });
      setAssetDialogOpen(false);
      setEditingAsset(null);
      assetForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fixed-assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: translateNow("toasts.assetDeleted"),
        description: translateNow("toasts.theFixedAssetHasBeenDeleted"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const depreciateMutation = useMutation({
    mutationFn: ({ id, month, year }: { id: string } & DepreciationRunData) =>
      apiRequest("POST", `/api/fixed-assets/${id}/depreciate`, { month, year }),
    onSuccess: (data: any) => {
      setDepRunDialogOpen(false);
      setDepAsset(null);
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: translateNow("toasts.depreciationRecorded"),
        description: formatMessage(translateNow("toasts.monthlyDepreciationRecorded"), {
          amount: formatCurrency(data.monthlyDepreciation, "AED", locale),
        }),
      });
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const disposeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DisposeFormData }) =>
      apiRequest("POST", `/api/fixed-assets/${id}/dispose`, {
        disposalDate: data.disposalDate,
        disposalAmount: data.disposalAmount,
        proceedsAccountId: data.onCredit ? null : data.proceedsAccountId || null,
        onCredit: data.onCredit === true,
        buyerName: data.buyerName || null,
        vatTreatment: data.vatTreatment ?? "standard",
        notes: data.notes || null,
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      const glType = data.gainLossType === "gain" ? "Gain" : "Loss";
      toast({
        title: translateNow("toasts.assetDisposed"),
        description: formatMessage(translateNow("toasts.glOnDisposal"), {
          glType,
          amount: formatCurrency(Math.abs(data.gainLoss), "AED", locale),
        }),
      });
      setDisposeDialogOpen(false);
      setDisposingAsset(null);
      disposeForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const runDepreciationMutation = useMutation({
    mutationFn: (data: DepreciationRunData) =>
      apiRequest("POST", `/api/companies/${companyId}/fixed-assets/run-depreciation`, data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: translateNow("toasts.batchDepreciationComplete"),
        description: formatMessage(translateNow("toasts.processedAssetsFor"), {
          assetsProcessed: data.assetsProcessed,
          month: data.month,
          year: data.year,
        }),
      });
      setDepRunDialogOpen(false);
      depRunForm.reset(lastEndedMonth());
    },
    onError: (error: Error) => {
      toast({
        title: errorHeading(error),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // ─── Handlers ───────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingAsset(null);
    assetForm.reset({
      assetName: "",
      assetNameAr: "",
      assetNumber: "",
      category: "",
      purchaseDate: "",
      purchaseCost: 0,
      salvageValue: 0,
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
      location: "",
      serialNumber: "",
      notes: "",
    });
    setAssetDialogOpen(true);
  };

  const handleOpenEditDialog = (asset: FixedAsset) => {
    setEditingAsset(asset);
    assetForm.reset({
      assetName: asset.asset_name,
      assetNameAr: asset.asset_name_ar || "",
      assetNumber: asset.asset_number || "",
      category: asset.category,
      purchaseDate: asset.purchase_date
        ? format(parseCalendarDate(asset.purchase_date), "yyyy-MM-dd")
        : "",
      purchaseCost: parseFloat(asset.purchase_cost),
      salvageValue: parseFloat(asset.salvage_value || "0"),
      usefulLifeYears: asset.useful_life_years,
      depreciationMethod:
        asset.depreciation_method === "declining_balance" ? "declining_balance" : "straight_line",
      location: asset.location || "",
      serialNumber: asset.serial_number || "",
      notes: asset.notes || "",
    });
    setAssetDialogOpen(true);
  };

  const handleOpenDisposeDialog = (asset: FixedAsset) => {
    setDisposingAsset(asset);
    disposeForm.reset({
      disposalDate: format(new Date(), "yyyy-MM-dd"),
      disposalAmount: 0,
      notes: "",
    });
    setDisposeDialogOpen(true);
  };

  const handleAssetSubmit = (data: AssetFormData) => {
    if (editingAsset) {
      updateAssetMutation.mutate({ id: editingAsset.id, data });
    } else {
      createAssetMutation.mutate(data);
    }
  };

  const handleDisposeSubmit = (data: DisposeFormData) => {
    if (!disposingAsset) return;
    disposeMutation.mutate({ id: disposingAsset.id, data });
  };

  const handleDepRunSubmit = (data: DepreciationRunData) => {
    if (depAsset) depreciateMutation.mutate({ id: depAsset.id, ...data });
    else runDepreciationMutation.mutate(data);
  };
  const openDepreciationDialog = (asset: FixedAsset | null) => {
    setDepAsset(asset);
    depRunForm.reset(lastEndedMonth());
    setDepRunDialogOpen(true);
  };

  // ─── Helpers ────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <StatusBadge tone="success">
            <T k="pages.active" />
          </StatusBadge>
        );
      case "disposed":
        return (
          <StatusBadge tone="neutral">
            <T k="pageLabels.disposed" />
          </StatusBadge>
        );
      case "draft":
        return (
          <StatusBadge tone="warning">
            <T k="pageLabels.assetDraftFromBill" />
          </StatusBadge>
        );
      case "fully_depreciated":
        return (
          <StatusBadge tone="neutral">
            <T k="pageLabels.fullyDepreciated" />
          </StatusBadge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredAssets = assets.filter((asset) =>
    matchesAssetSearch(asset, searchQuery, t[`forms.asset.cat.${asset.category}`])
  );
  const hasSearch = searchQuery.trim().length > 0;
  // Offline before the first fetch: the register is unknown, not empty.
  const showAssetsOffline = assetsPaused && assetsData === undefined;

  // ─── Loading State ─────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <StatCardSkeleton count={3} />
        <Card>
          <CardContent className="pt-6">
            <TableSkeleton rows={5} columns={7} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!companyId) {
    return (
      <EmptyState
        icon={Building2}
        title={t["screens.noCompanySelected"]}
        description={t["screens.noCompanyAssetsBody"]}
      />
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title={t["pages.fixedAssets"]}
        description={t["pageLabels.manageFixedAssetsDepreciationAndDisposals"]}
        primaryAction={
          <Button
            onClick={handleOpenCreateDialog}
            data-testid="button-add-asset"
            {...gate("documents.write")}
          >
            <Plus aria-hidden />
            <T k="pageLabels.addAsset" />
          </Button>
        }
        overflow={
          <>
            <DropdownMenuItem
              onSelect={() => openDepreciationDialog(null)}
              disabled={!can("ledger.post")}
              data-testid="menu-run-depreciation"
            >
              <PlayCircle aria-hidden />
              <T k="pageLabels.runDepreciation" />
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/api/companies/${companyId}/fixed-assets/register?format=xlsx`}>
                <Download aria-hidden />
                {fa.exportRegister}
              </a>
            </DropdownMenuItem>
          </>
        }
      />

      {summaryLoadFailed && (
        <Card>
          <ErrorState
            compact
            title={t["screens.assetSummaryErrorTitle"]}
            description={t["screens.assetSummaryErrorBody"]}
            onRetry={() => void refetchSummary()}
            testId="error-state-fixed-assets-summary"
          />
        </Card>
      )}

      {/* Spec 2.6: no KPI row of zeros before the first asset exists. */}
      {summary && assets.length > 0 && (
        <div className="mobile-keep-cols grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard
            label={t["pages.totalCost"]}
            icon={DollarSign}
            value={<Money amount={summary.totalCost} />}
            hint={formatMessage(t["screens.activeAssetsCount"], { count: summary.totalAssets })}
          />
          <StatCard
            label={t["pageLabels.accumulatedDepreciation"]}
            icon={TrendingDown}
            value={<Money amount={summary.totalAccumulatedDepreciation} />}
            hint={formatMessage(t["screens.percentDepreciated"], {
              pct:
                summary.totalCost > 0
                  ? // Isolated LTR "1.7%" so the sign stays after the digits in Arabic.
                    `\u2066${((summary.totalAccumulatedDepreciation / summary.totalCost) * 100).toFixed(1)}%\u2069`
                  : "\u20660%\u2069",
            })}
          />
          <StatCard
            label={t["pages.netBookValue"]}
            icon={BarChart3}
            value={<Money amount={summary.totalNetBookValue} />}
            hint={t["pageLabels.currentCarryingValue"]}
          />
        </div>
      )}

      {/* Assets */}
      <section className="space-y-3">
        {!showAssetsError && !showAssetsOffline && (assets.length > 0 || searchQuery) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full sm:w-80">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder={t["screens.searchAssets"]}
                aria-label={t["screens.searchAssets"]}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 ps-9"
              />
            </div>
            <p className="text-small text-muted-foreground">
              {formatMessage(t["screens.assetsRegistered"], { count: assets.length })}
            </p>
          </div>
        )}
        <DataTableCard
          status={
            isLoadingAssets
              ? "loading"
              : showAssetsError
                ? "error"
                : showAssetsOffline || filteredAssets.length === 0
                  ? "empty"
                  : "ready"
          }
          error={{
            title: t["common.loadFailedTitle"],
            description: t["common.loadFailedBody"],
            onRetry: () => void refetchAssets(),
            testId: "error-state-fixed-assets",
          }}
          columnLabels={[t["pageLabels.assetName"], t["screens.cost"], t["screens.nbv"], t.status]}
          empty={
            showAssetsOffline
              ? {
                  icon: WifiOff,
                  title: t["screens.assetsOfflineTitle"],
                  description: t["screens.assetsOfflineBody"],
                  testId: "offline-state-fixed-assets",
                }
              : hasSearch
                ? {
                    icon: Building2,
                    title: t["screens.noMatchingAssets"],
                    description: t["screens.noMatchingAssetsBody"],
                    action: {
                      label: t["screens.clearSearch"],
                      onClick: () => setSearchQuery(""),
                      variant: "outline",
                    },
                    testId: "empty-state-fixed-assets-search",
                  }
                : {
                    icon: Building2,
                    title: t["screens.noFixedAssets"],
                    description: t["screens.noFixedAssetsBody"],
                    action: {
                      label: t["pageLabels.addAsset"],
                      icon: Plus,
                      onClick: handleOpenCreateDialog,
                    },
                    testId: "empty-state-fixed-assets",
                  }
          }
        >
          <Table className="row-cards">
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">
                  <T k="pageLabels.assetName" />
                </TableHead>
                <TableHead>
                  <T k="pages.category" />
                </TableHead>
                <TableHead>
                  <T k="pageLabels.purchaseDate" />
                </TableHead>
                <TableHead data-numeric="">{t["screens.cost"]}</TableHead>
                <TableHead data-numeric="">
                  <T k="pageLabels.accumDep" />
                </TableHead>
                <TableHead data-numeric="">{t["screens.nbv"]}</TableHead>
                <TableHead>
                  <T k="pages.status" />
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t.actions || "Actions"}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.map((asset) => {
                const canCapitalize =
                  asset.status === "active" &&
                  asset.needs_capitalization_je &&
                  !asset.capitalization_entry_id &&
                  !!cashAccounts[0];
                return (
                  <TableRow key={asset.id}>
                    <TableCell data-truncate="" data-cell="title">
                      <span dir="auto" className="font-medium">
                        {locale === "ar" && asset.asset_name_ar
                          ? asset.asset_name_ar
                          : asset.asset_name}
                      </span>
                      {asset.asset_number && (
                        <span
                          dir="ltr"
                          className="ms-2 hidden text-caption md:inline tabular-nums text-muted-foreground [unicode-bidi:isolate]"
                        >
                          {asset.asset_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      {t[`forms.asset.cat.${asset.category}`] || asset.category}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      {asset.purchase_date ? formatDate(asset.purchase_date, locale) : "—"}
                    </TableCell>
                    <MoneyCell
                      amount={parseFloat(asset.purchase_cost)}
                      className="text-muted-foreground"
                    />
                    <MoneyCell
                      amount={parseFloat(asset.accumulated_depreciation || "0")}
                      className="text-muted-foreground"
                    />
                    <MoneyCell
                      amount={parseFloat(asset.net_book_value || "0")}
                      className="font-semibold"
                      data-cell="amount"
                    />
                    <TableCell data-nowrap="" data-cell="status">
                      {getStatusBadge(asset.status)}
                    </TableCell>
                    <TableCell data-cell="actions">
                      <RowActions
                        maxInline={1}
                        collapseOnMobile
                        menu={
                          <>
                            {canCapitalize && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setCapPaidFrom(cashAccounts[0]?.id ?? "");
                                  setCapInputVat("");
                                  setCapitalizeTarget(asset);
                                }}
                                data-testid={`button-capitalize-${asset.id}`}
                                disabled={capitalizeMutation.isPending || !can("ledger.post")}
                                title={fa.capitalizeHint}
                              >
                                <BookCheck aria-hidden />
                                {fa.capitalize}
                              </DropdownMenuItem>
                            )}
                            {asset.status === "active" && (
                              <DropdownMenuItem
                                onSelect={() => handleOpenDisposeDialog(asset)}
                                disabled={!can("ledger.post")}
                              >
                                <Ban aria-hidden />
                                {t["screens.dispose"]}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setAssetToDelete(asset.id)}
                              disabled={!can("documents.write")}
                            >
                              <Trash2 aria-hidden />
                              {t.delete}
                            </DropdownMenuItem>
                          </>
                        }
                      >
                        {asset.status === "draft" && (
                          <RowActionButton
                            label={t.edit}
                            icon={Edit}
                            onClick={() => handleOpenEditDialog(asset)}
                            {...gate("documents.write")}
                          />
                        )}
                        {asset.status === "active" && (
                          <>
                            <RowActionButton
                              label={t["screens.recordDepreciation"]}
                              icon={Calculator}
                              onClick={() => openDepreciationDialog(asset)}
                              disabled={depreciateMutation.isPending}
                              data-testid={`button-record-depreciation-${asset.id}`}
                              {...gate("ledger.post")}
                            />
                            <RowActionButton
                              label={t.edit}
                              icon={Edit}
                              onClick={() => handleOpenEditDialog(asset)}
                              {...gate("documents.write")}
                            />
                          </>
                        )}
                      </RowActions>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTableCard>
      </section>

      {/* Category breakdown */}
      {categories.length > 0 && (
        <SectionCard title={t["pageLabels.assetCategoryBreakdown"]} flush>
          <Table className="mobile-fit">
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">
                  <T k="pages.category" />
                </TableHead>
                <TableHead data-numeric="">
                  <T k="pageLabels.count" />
                </TableHead>
                <TableHead data-numeric="" className="hidden sm:table-cell">
                  <T k="pages.totalCost" />
                </TableHead>
                <TableHead data-numeric="" className="hidden sm:table-cell">
                  <T k="pageLabels.accumDepreciation" />
                </TableHead>
                <TableHead data-numeric="">
                  <T k="pages.netBookValue" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.category}>
                  <TableCell className="font-medium">
                    {t[`forms.asset.cat.${cat.category}`] || cat.category}
                  </TableCell>
                  <TableCell data-numeric="">{cat.count}</TableCell>
                  <MoneyCell amount={cat.totalCost} className="hidden sm:table-cell" />
                  <MoneyCell
                    amount={cat.totalAccumulatedDepreciation}
                    className="hidden sm:table-cell"
                  />
                  <MoneyCell amount={cat.totalNetBookValue} className="font-medium" />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      {/* ─── Create/Edit Asset Dialog ──────────────────────── */}
      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent size="lg" data-testid="dialog-asset-form">
          <DialogHeader>
            <DialogTitle>
              {editingAsset ? t["screens.editFixedAsset"] : t["screens.addFixedAsset"]}
            </DialogTitle>
            <DialogDescription>
              {editingAsset ? t["screens.updateAssetDetails"] : t["screens.registerNewAsset"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...assetForm}>
            <form
              onSubmit={assetForm.handleSubmit(handleAssetSubmit)}
              noValidate
              className="space-y-6"
            >
              <FormErrorSummary />
              <FormSection title={t["forms.section.asset"]}>
                <FormGrid>
                  <FormField
                    control={assetForm.control}
                    name="assetName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.faAssetName"]}</FormLabel>
                        <FormControl>
                          <Input
                            dir="auto"
                            placeholder={t["forms.asset.namePlaceholder"]}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="assetNameAr"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["screens.faAssetNameArabic"]}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="اسم الأصل"
                            dir="rtl"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="assetNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pageLabels.assetNumber" />
                        </FormLabel>
                        <FormControl>
                          <Input ltr placeholder="FA-001" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.faCategory"]}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t["screens.faSelectCategory"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {CATEGORIES.map((cat) => (
                              <SelectItem key={cat} value={cat}>
                                {t[`forms.asset.cat.${cat}`] || cat}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pageLabels.location" />
                        </FormLabel>
                        <FormControl>
                          <Input
                            dir="auto"
                            placeholder={t["forms.asset.locationPlaceholder"]}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="serialNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pageLabels.serialNumber" />
                        </FormLabel>
                        <FormControl>
                          <Input ltr placeholder="SN-12345" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>
              <FormSection title={t["forms.section.acquisition"]}>
                <FormGrid>
                  <FormField
                    control={assetForm.control}
                    name="purchaseDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.faPurchaseDate"]}</FormLabel>
                        <FormControl>
                          <DatePicker value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="purchaseCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.faPurchaseCostAed"]}</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {!editingAsset && (
                    <FormField
                      control={assetForm.control}
                      name="paymentAccountId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{fa.paidFrom}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={fa.notCapitalised} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {cashAccounts.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.code} — {accountDisplayName(a, locale)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription>{t["forms.asset.paidFromHelp"]}</FormDescription>
                        </FormItem>
                      )}
                    />
                  )}
                  {!editingAsset && assetForm.watch("paymentAccountId") && (
                    <FormField
                      control={assetForm.control}
                      name="inputVat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t["forms.asset.inputVat"]}</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              data-testid="input-asset-input-vat"
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value)}
                            />
                          </FormControl>
                          <FormDescription>{t["forms.asset.inputVatHelp"]}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </FormGrid>
              </FormSection>
              <FormSection
                title={t["forms.section.depreciation"]}
                description={t["forms.section.depreciationDesc"]}
              >
                <FormGrid>
                  <FormField
                    control={assetForm.control}
                    name="depreciationMethod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pageLabels.depreciationMethod" />
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || "straight_line"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t["screens.faSelectMethod"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="straight_line">
                              <T k="pageLabels.straightLine" />
                            </SelectItem>
                            <SelectItem value="declining_balance">
                              <T k="pageLabels.decliningBalance" />
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="usefulLifeYears"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{fa.usefulLife}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            {...field}
                            value={field.value ?? ""}
                            disabled={assetCategory?.toLowerCase() === "land"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={assetForm.control}
                    name="salvageValue"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["screens.faSalvageValueAed"]}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            {...field}
                            value={field.value ?? 0}
                          />
                        </FormControl>
                        <FormDescription>{t["forms.asset.salvageHelp"]}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>
              <FormSection title={t["forms.section.notes"]}>
                <FormField
                  control={assetForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className={formSpanFull}>
                      <FormLabel>
                        <T k="pages.notes" />
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t["screens.faOptionalNotesAboutThisAsset"]}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormSection>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setAssetDialogOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={createAssetMutation.isPending || updateAssetMutation.isPending}
                >
                  {createAssetMutation.isPending || updateAssetMutation.isPending
                    ? t["forms.saving"]
                    : editingAsset
                      ? t.save
                      : t["pageLabels.addAsset"]}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Dispose Dialog ────────────────────────────────── */}
      <Dialog open={disposeDialogOpen} onOpenChange={setDisposeDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.disposeAsset" />
            </DialogTitle>
            <DialogDescription>
              {disposingAsset
                ? `Record disposal for "${disposingAsset.asset_name}" (NBV: ${formatCurrency(parseFloat(disposingAsset.net_book_value || "0"), "AED", locale)})`
                : t["fixedAssets.recordAssetDisposal"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...disposeForm}>
            <form onSubmit={disposeForm.handleSubmit(handleDisposeSubmit)} className="space-y-4">
              <FormField
                control={disposeForm.control}
                name="disposalDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t["screens.faDisposalDate"]} <span className="text-danger">*</span>
                    </FormLabel>
                    <FormControl>
                      <DatePicker value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="disposalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t["screens.faDisposalAmountAed"]}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="onCredit"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(v) => field.onChange(v === true)}
                        data-testid="checkbox-dispose-on-credit"
                      />
                      {fa.onCredit}
                    </label>
                    {disposeOnCredit && (
                      <p className="text-xs text-muted-foreground">{fa.onCreditHint}</p>
                    )}
                  </FormItem>
                )}
              />

              {!disposeOnCredit && (
                <FormField
                  control={disposeForm.control}
                  name="proceedsAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{fa.proceedsAccount}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={fa.cashDefault} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cashAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.code} — {accountDisplayName(a, locale)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={disposeForm.control}
                name="buyerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{fa.buyer}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="vatTreatment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{fa.vat}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? "standard"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="standard">{fa.vatStandard}</SelectItem>
                        <SelectItem value="zero_rated">{fa.vatZero}</SelectItem>
                        <SelectItem value="exempt">{fa.vatExempt}</SelectItem>
                        <SelectItem value="out_of_scope">{fa.vatOutOfScope}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <T k="pages.notes" />
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t["screens.faReasonForDisposal"]}
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDisposeDialogOpen(false)}>
                  {t.cancel || "Cancel"}
                </Button>
                <Button type="submit" variant="destructive" disabled={disposeMutation.isPending}>
                  {disposeMutation.isPending
                    ? t.loading || "Loading..."
                    : t["pageLabels.disposeAsset"]}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Capitalise Dialog (E3, J3-r3): paid-from account and input VAT ─── */}
      <Dialog
        open={!!capitalizeTarget}
        onOpenChange={(open) => {
          if (!open) setCapitalizeTarget(null);
        }}
      >
        <DialogContent size="sm" data-testid="dialog-capitalize">
          <DialogHeader>
            <DialogTitle>{fa.capitalize}</DialogTitle>
            <DialogDescription>{fa.capitalizeHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="capitalize-paid-from">{fa.paidFrom}</Label>
              <Select value={capPaidFrom} onValueChange={setCapPaidFrom}>
                <SelectTrigger id="capitalize-paid-from" data-testid="select-capitalize-paid-from">
                  <SelectValue placeholder={fa.paidFrom} />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} — {accountDisplayName(a, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="capitalize-input-vat">{t["forms.asset.inputVat"]}</Label>
              <Input
                id="capitalize-input-vat"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={capInputVat}
                onChange={(e) => setCapInputVat(e.target.value)}
                data-testid="input-capitalize-input-vat"
              />
              <p className="text-xs text-muted-foreground">{t["forms.asset.inputVatHelp"]}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCapitalizeTarget(null)}>
              {t["common.cancel"]}
            </Button>
            <Button
              onClick={() =>
                capitalizeTarget &&
                capitalizeMutation.mutate({
                  id: capitalizeTarget.id,
                  paymentAccountId: capPaidFrom,
                  inputVat: Number(capInputVat) || 0,
                })
              }
              disabled={!capPaidFrom || capitalizeMutation.isPending}
              data-testid="button-confirm-capitalize"
              {...gate("ledger.post")}
            >
              {fa.capitalize}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Run Depreciation Dialog ───────────────────────── */}
      <Dialog
        open={depRunDialogOpen}
        onOpenChange={(open) => {
          setDepRunDialogOpen(open);
          if (!open) setDepAsset(null);
        }}
      >
        <DialogContent size="sm" data-testid="dialog-depreciation">
          <DialogHeader>
            <DialogTitle>
              {depAsset ? (
                formatMessage(t["fixedAssets.recordDepreciationFor"], {
                  name: depAsset.asset_name,
                })
              ) : (
                <T k="pageLabels.runMonthlyDepreciation" />
              )}
            </DialogTitle>
            <DialogDescription>
              {depAsset
                ? t["fixedAssets.recordDepreciationHelp"]
                : t["fixedAssets.calculateAndRecordDepreciationFor"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...depRunForm}>
            <form onSubmit={depRunForm.handleSubmit(handleDepRunSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={depRunForm.control}
                  name="month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t["screens.faMonth"]} <span className="text-danger">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v))}
                        value={String(field.value)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t["screens.faSelectMonth"]} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">
                            <T k="pages.january" />
                          </SelectItem>
                          <SelectItem value="2">
                            <T k="pages.february" />
                          </SelectItem>
                          <SelectItem value="3">
                            <T k="pages.march" />
                          </SelectItem>
                          <SelectItem value="4">
                            <T k="pages.april" />
                          </SelectItem>
                          <SelectItem value="5">May</SelectItem>
                          <SelectItem value="6">June</SelectItem>
                          <SelectItem value="7">July</SelectItem>
                          <SelectItem value="8">
                            <T k="pages.august" />
                          </SelectItem>
                          <SelectItem value="9">
                            <T k="pages.september" />
                          </SelectItem>
                          <SelectItem value="10">
                            <T k="pages.october" />
                          </SelectItem>
                          <SelectItem value="11">
                            <T k="pages.november" />
                          </SelectItem>
                          <SelectItem value="12">
                            <T k="pages.december" />
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={depRunForm.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t["screens.faYear"]} <span className="text-danger">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="number" min="2000" max="2100" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDepRunDialogOpen(false)}>
                  {t.cancel || "Cancel"}
                </Button>
                <Button
                  type="submit"
                  disabled={runDepreciationMutation.isPending || depreciateMutation.isPending}
                  data-testid="button-confirm-depreciation"
                >
                  {runDepreciationMutation.isPending || depreciateMutation.isPending
                    ? t.loading || "Loading..."
                    : depAsset
                      ? t["screens.recordDepreciation"]
                      : t["pageLabels.runDepreciation"]}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!assetToDelete}
        onOpenChange={(open) => {
          if (!open) setAssetToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pageLabels.deleteFixedAsset" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t["fixedAssets.thisWillPermanentlyDeleteThis"]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (assetToDelete) {
                  deleteAssetMutation.mutate(assetToDelete);
                  setAssetToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pages.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface LedgerAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  type: string;
  subType: string | null;
}

// W4-B copy (en + ar) for the register additions.
const FA_COPY = {
  en: {
    usefulLife: "Useful life (years) — not needed for land",
    paidFrom: "Paid from (posts the capitalisation)",
    notCapitalised: "Not paid yet — capitalise later",
    exportRegister: "Export register (xlsx)",
    capitalize: "Capitalise",
    capitalizeHint: "Post the purchase to the ledger so the asset can be depreciated",
    capitalized: "Asset capitalised on the ledger",
    onCredit: "Sold on credit",
    onCreditHint:
      "A tax invoice is issued to the buyer for the sale price plus VAT; the receivable is collected on that invoice.",
    proceedsAccount: "Proceeds received into",
    cashDefault: "Cash on hand (1010)",
    buyer: "Buyer",
    vat: "VAT on the sale",
    vatStandard: "Standard rated 5%",
    vatZero: "Zero rated",
    vatExempt: "Exempt",
    vatOutOfScope: "Out of scope",
  },
  ar: {
    usefulLife: "العمر الإنتاجي (سنوات) — غير مطلوب للأراضي",
    paidFrom: "مدفوع من (يرحّل قيد الرسملة)",
    notCapitalised: "لم يُدفع بعد — رسملة لاحقاً",
    exportRegister: "تصدير السجل (xlsx)",
    capitalize: "رسملة",
    capitalizeHint: "ترحيل الشراء إلى دفتر الأستاذ ليتسنى استهلاك الأصل",
    capitalized: "تمت رسملة الأصل في دفتر الأستاذ",
    onCredit: "بيع آجل",
    onCreditHint:
      "تصدر فاتورة ضريبية للمشتري بسعر البيع مع الضريبة، ويُحصَّل المبلغ المستحق على تلك الفاتورة.",
    proceedsAccount: "استلام المتحصلات في",
    cashDefault: "النقد في الصندوق (1010)",
    buyer: "المشتري",
    vat: "ضريبة القيمة المضافة على البيع",
    vatStandard: "خاضع بنسبة 5%",
    vatZero: "خاضع بنسبة الصفر",
    vatExempt: "معفى",
    vatOutOfScope: "خارج النطاق",
  },
} as const;
