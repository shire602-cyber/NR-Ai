import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
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
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { messages as pageMessages } from "./FixedAssets.i18n";

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
  useful_life_years: number;
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

// i18n-ignore-start: category ids stored with each record; the UI shows translated labels (assetCategoryLabel)
const CATEGORIES = [
  "Vehicles",
  "Furniture",
  "Equipment",
  "Electronics",
  "Building",
  "Land",
  "Other",
] as const;
// i18n-ignore-end

const CATEGORIES_LABEL_KEYS = {
  Vehicles: "assetCategoryVehicles",
  Furniture: "assetCategoryFurniture",
  Equipment: "assetCategoryEquipment",
  Electronics: "assetCategoryElectronics",
  Building: "assetCategoryBuilding",
  Land: "assetCategoryLand",
  Other: "assetCategoryOther",
} as const;

/** Display label for a stored category id (the id itself stays English). */
function assetCategoryLabel(category: string): string {
  const key = CATEGORIES_LABEL_KEYS[category as keyof typeof CATEGORIES_LABEL_KEYS];
  return key ? pageMessages.t(key) : category;
}

const assetFormSchema = z.object({
  assetName: z.string().min(1, pageMessages.marker("assetNameIsRequired")),
  assetNameAr: z.string().optional().nullable(),
  assetNumber: z.string().optional().nullable(),
  category: z.string().min(1, pageMessages.marker("categoryIsRequired")),
  purchaseDate: z.string().min(1, pageMessages.marker("purchaseDateIsRequired")),
  purchaseCost: z.coerce.number().min(0, pageMessages.marker("purchaseCostMustBe0")),
  salvageValue: z.coerce
    .number()
    .min(0, pageMessages.marker("salvageValueMustBe0"))
    .optional()
    .nullable(),
  usefulLifeYears: z.coerce.number().int().min(1, pageMessages.marker("usefulLifeMustBeAtLeast")),
  depreciationMethod: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type AssetFormData = z.infer<typeof assetFormSchema>;

const disposeFormSchema = z.object({
  disposalDate: z.string().min(1, pageMessages.marker("disposalDateIsRequired")),
  disposalAmount: z.coerce.number().min(0, pageMessages.marker("disposalAmountMustBe0")),
  notes: z.string().optional().nullable(),
});

type DisposeFormData = z.infer<typeof disposeFormSchema>;

const depreciationRunSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

type DepreciationRunData = z.infer<typeof depreciationRunSchema>;

// ─── Component ───────────────────────────────────────────

export default function FixedAssets() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FixedAsset | null>(null);
  const [disposeDialogOpen, setDisposeDialogOpen] = useState(false);
  const [disposingAsset, setDisposingAsset] = useState<FixedAsset | null>(null);
  const [depRunDialogOpen, setDepRunDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────

  const { data: assets = [], isLoading: isLoadingAssets } = useQuery<FixedAsset[]>({
    queryKey: [`/api/companies/${companyId}/fixed-assets`],
    enabled: !!companyId,
  });

  const { data: summary } = useQuery<AssetSummary>({
    queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
    enabled: !!companyId,
  });

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

  const depRunForm = useForm<DepreciationRunData>({
    resolver: zodResolver(depreciationRunSchema),
    defaultValues: {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    },
  });

  // ─── Mutations ──────────────────────────────────────────

  const createAssetMutation = useMutation({
    mutationFn: (data: AssetFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/fixed-assets`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: tr("assetCreated"),
        description: tr("theFixedAssetHasBeenAdded"),
      });
      setAssetDialogOpen(false);
      assetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AssetFormData> }) =>
      apiRequest("PATCH", `/api/fixed-assets/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: tr("assetUpdated"),
        description: tr("theFixedAssetHasBeenUpdated"),
      });
      setAssetDialogOpen(false);
      setEditingAsset(null);
      assetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fixed-assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({ title: tr("assetDeleted"), description: tr("theFixedAssetHasBeenDeleted") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const depreciateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/fixed-assets/${id}/depreciate`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      toast({
        title: tr("depreciationRecorded"),
        description: tr("monthlyDepreciationOfRecorded", {
          formatCurrency: formatCurrency(data.monthlyDepreciation, "AED", locale),
        }),
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const disposeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DisposeFormData }) =>
      apiRequest("POST", `/api/fixed-assets/${id}/dispose`, data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/fixed-assets`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/fixed-assets/summary`],
      });
      const glType = data.gainLossType === "gain" ? tr("gain") : tr("loss");
      toast({
        title: tr("assetDisposed"),
        description: tr("onDisposal", {
          glType,
          formatCurrency: formatCurrency(Math.abs(data.gainLoss), "AED", locale),
        }),
      });
      setDisposeDialogOpen(false);
      setDisposingAsset(null);
      disposeForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
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
        title: tr("batchDepreciationComplete"),
        description: tr("processedAssetsFor", {
          assetsProcessed: data.assetsProcessed,
          month: data.month,
          year: data.year,
        }),
      });
      setDepRunDialogOpen(false);
      depRunForm.reset({ month: new Date().getMonth() + 1, year: new Date().getFullYear() });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
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
      purchaseDate: asset.purchase_date ? format(new Date(asset.purchase_date), "yyyy-MM-dd") : "",
      purchaseCost: parseFloat(asset.purchase_cost),
      salvageValue: parseFloat(asset.salvage_value || "0"),
      usefulLifeYears: asset.useful_life_years,
      depreciationMethod: asset.depreciation_method || "straight_line",
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
    runDepreciationMutation.mutate(data);
  };

  // ─── Helpers ────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <StatusBadge tone="success">{tr("active")}</StatusBadge>;
      case "disposed":
        return <StatusBadge tone="danger">{tr("disposed")}</StatusBadge>;
      case "fully_depreciated":
        return <StatusBadge tone="warning">{tr("fullyDepreciated")}</StatusBadge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredAssets = assets.filter((asset) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      asset.asset_name.toLowerCase().includes(q) ||
      asset.category.toLowerCase().includes(q) ||
      (asset.asset_number && asset.asset_number.toLowerCase().includes(q)) ||
      (asset.serial_number && asset.serial_number.toLowerCase().includes(q)) ||
      (asset.asset_name_ar && asset.asset_name_ar.includes(q))
    );
  });

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
        title={tr("noCompanySelected")}
        description={tr("createOrSelectACompanyBefore")}
      />
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-8 h-8" />
            {tr("fixedAssets")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {tr("manageFixedAssetsDepreciationAndDisposals")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setDepRunDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <PlayCircle className="w-4 h-4" />
            {tr("runDepreciation")}
          </Button>
          <Button onClick={handleOpenCreateDialog} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {tr("addAsset")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tr("totalCost")}</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.totalCost, "AED", locale)}
              </div>
              <p className="text-xs text-muted-foreground">
                {tr.plural("activeAssets", summary.totalAssets)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tr("accumulatedDepreciation")}</CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.totalAccumulatedDepreciation, "AED", locale)}
              </div>
              <p className="text-xs text-muted-foreground">
                {summary.totalCost > 0
                  ? tr("depreciated", {
                      value: (
                        (summary.totalAccumulatedDepreciation / summary.totalCost) *
                        100
                      ).toFixed(1),
                    })
                  : tr("n0Depreciated")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tr("netBookValue")}</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.totalNetBookValue, "AED", locale)}
              </div>
              <p className="text-xs text-muted-foreground">{tr("currentCarryingValue")}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category Breakdown */}
      {summary && summary.byCategory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tr("assetCategoryBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("category")}</TableHead>
                    <TableHead className="text-end">{tr("count")}</TableHead>
                    <TableHead className="text-end">{tr("totalCost")}</TableHead>
                    <TableHead className="text-end">{tr("accumDepreciation")}</TableHead>
                    <TableHead className="text-end">{tr("netBookValue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byCategory.map((cat) => (
                    <TableRow key={cat.category}>
                      <TableCell className="font-medium">
                        {assetCategoryLabel(cat.category)}
                      </TableCell>
                      <TableCell className="text-end">{cat.count}</TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(cat.totalCost, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(cat.totalAccumulatedDepreciation, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(cat.totalNetBookValue, "AED", locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assets Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{tr("fixedAssets")}</CardTitle>
              <CardDescription>{tr.plural("assetsRegistered", assets.length)}</CardDescription>
            </div>
          </div>
          <div className="mt-4">
            <Input
              placeholder={tr("searchAssetsByNameCategoryNumber")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingAssets ? (
            <TableSkeleton rows={5} columns={7} />
          ) : filteredAssets.length === 0 ? (
            searchQuery ? (
              <EmptyState
                icon={Building2}
                title={tr("noMatchingAssets")}
                description={tr("noAssetsMatchTryADifferent", { searchQuery })}
                action={{
                  label: tr("clearSearch"),
                  onClick: () => setSearchQuery(""),
                  variant: "outline",
                }}
                testId="empty-state-fixed-assets-search"
              />
            ) : (
              <EmptyState
                icon={Building2}
                title={tr("noFixedAssetsYet")}
                description={tr("trackEquipmentVehiclesAndOtherDepreciable")}
                action={{ label: tr("addAsset"), icon: Plus, onClick: handleOpenCreateDialog }}
                testId="empty-state-fixed-assets"
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("assetName")}</TableHead>
                    <TableHead>{tr("category")}</TableHead>
                    <TableHead>{tr("purchaseDate")}</TableHead>
                    <TableHead className="text-end">{tr("cost")}</TableHead>
                    <TableHead className="text-end">{tr("accumDep")}</TableHead>
                    <TableHead className="text-end">NBV</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead className="text-end">{t.actions || tr("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium">
                        <div>
                          {asset.asset_name}
                          {asset.asset_name_ar && (
                            <div className="text-xs text-muted-foreground">
                              {asset.asset_name_ar}
                            </div>
                          )}
                          {asset.asset_number && (
                            <div className="text-xs text-muted-foreground">
                              #{asset.asset_number}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{assetCategoryLabel(asset.category)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {asset.purchase_date
                          ? format(new Date(asset.purchase_date), "MMM dd, yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(parseFloat(asset.purchase_cost), "AED", locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        {formatCurrency(
                          parseFloat(asset.accumulated_depreciation || "0"),
                          "AED",
                          locale
                        )}
                      </TableCell>
                      <TableCell className="text-end font-semibold">
                        {formatCurrency(parseFloat(asset.net_book_value || "0"), "AED", locale)}
                      </TableCell>
                      <TableCell>{getStatusBadge(asset.status)}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          {asset.status === "active" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => depreciateMutation.mutate(asset.id)}
                                title={tr("recordDepreciation")}
                                disabled={depreciateMutation.isPending}
                              >
                                <Calculator className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditDialog(asset)}
                                title={tr("edit")}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenDisposeDialog(asset)}
                                title={tr("dispose")}
                                className="text-[hsl(var(--chart-4))] hover:text-[hsl(var(--chart-4))]"
                              >
                                <Ban className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAssetToDelete(asset.id)}
                            title={tr("delete")}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Create/Edit Asset Dialog ──────────────────────── */}
      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? tr("editFixedAsset") : tr("addFixedAsset")}</DialogTitle>
            <DialogDescription>
              {editingAsset ? tr("updateAssetDetails") : tr("registerANewFixedAsset")}
            </DialogDescription>
          </DialogHeader>

          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(handleAssetSubmit)} className="space-y-4">
              <FormField
                control={assetForm.control}
                name="assetName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("assetName2")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tr("eGToyotaHilux2024")} {...field} />
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
                    <FormLabel>{tr("assetNameArabic")}</FormLabel>
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

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="assetNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("assetNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., FA-001" {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("category2")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectCategory")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {assetCategoryLabel(cat)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="purchaseDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("purchaseDate2")}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
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
                      <FormLabel>{tr("purchaseCostAed")}</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="salvageValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("salvageValueAed")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...field}
                          value={field.value ?? 0}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={assetForm.control}
                  name="usefulLifeYears"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("usefulLifeYears")}</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" step="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={assetForm.control}
                name="depreciationMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("depreciationMethod")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || "straight_line"}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tr("selectMethod")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="straight_line">{tr("straightLine")}</SelectItem>
                        <SelectItem value="declining_balance">{tr("decliningBalance")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={assetForm.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("location")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tr("eGDubaiOffice")}
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
                      <FormLabel>{tr("serialNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., SN-12345" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={assetForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tr("optionalNotesAboutThisAsset")}
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setAssetDialogOpen(false)}>
                  {t.cancel || tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createAssetMutation.isPending || updateAssetMutation.isPending}
                >
                  {createAssetMutation.isPending || updateAssetMutation.isPending
                    ? t.loading || tr("loading")
                    : editingAsset
                      ? t.save || tr("save")
                      : tr("addAsset")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Dispose Dialog ────────────────────────────────── */}
      <Dialog open={disposeDialogOpen} onOpenChange={setDisposeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("disposeAsset")}</DialogTitle>
            <DialogDescription>
              {disposingAsset
                ? tr("recordDisposalForNbv", {
                    asset_name: disposingAsset.asset_name,
                    formatCurrency: formatCurrency(
                      parseFloat(disposingAsset.net_book_value || "0"),
                      "AED",
                      locale
                    ),
                  })
                : tr("recordAssetDisposal")}
            </DialogDescription>
          </DialogHeader>

          <Form {...disposeForm}>
            <form onSubmit={disposeForm.handleSubmit(handleDisposeSubmit)} className="space-y-4">
              <FormField
                control={disposeForm.control}
                name="disposalDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("disposalDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
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
                    <FormLabel>{tr("disposalAmountAed")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={disposeForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tr("reasonForDisposal")}
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
                  {t.cancel || tr("cancel")}
                </Button>
                <Button type="submit" variant="destructive" disabled={disposeMutation.isPending}>
                  {disposeMutation.isPending ? t.loading || tr("loading") : tr("disposeAsset")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Run Depreciation Dialog ───────────────────────── */}
      <Dialog open={depRunDialogOpen} onOpenChange={setDepRunDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("runMonthlyDepreciation")}</DialogTitle>
            <DialogDescription>{tr("calculateAndRecordDepreciationForAll")}</DialogDescription>
          </DialogHeader>

          <Form {...depRunForm}>
            <form onSubmit={depRunForm.handleSubmit(handleDepRunSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={depRunForm.control}
                  name="month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("month")}</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(parseInt(v))}
                        value={String(field.value)}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={tr("selectMonth")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">{tr("january")}</SelectItem>
                          <SelectItem value="2">{tr("february")}</SelectItem>
                          <SelectItem value="3">{tr("march")}</SelectItem>
                          <SelectItem value="4">{tr("april")}</SelectItem>
                          <SelectItem value="5">{tr("may")}</SelectItem>
                          <SelectItem value="6">{tr("june")}</SelectItem>
                          <SelectItem value="7">{tr("july")}</SelectItem>
                          <SelectItem value="8">{tr("august")}</SelectItem>
                          <SelectItem value="9">{tr("september")}</SelectItem>
                          <SelectItem value="10">{tr("october")}</SelectItem>
                          <SelectItem value="11">{tr("november")}</SelectItem>
                          <SelectItem value="12">{tr("december")}</SelectItem>
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
                      <FormLabel>{tr("year")}</FormLabel>
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
                  {t.cancel || tr("cancel")}
                </Button>
                <Button type="submit" disabled={runDepreciationMutation.isPending}>
                  {runDepreciationMutation.isPending
                    ? t.loading || tr("loading")
                    : tr("runDepreciation")}
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
            <AlertDialogTitle>{tr("deleteFixedAsset")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillPermanentlyDeleteThisAsset")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (assetToDelete) {
                  deleteAssetMutation.mutate(assetToDelete);
                  setAssetToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
