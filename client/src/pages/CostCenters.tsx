import { T } from "@/components/layout/T";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  formSpanFull,
} from "@/components/ui/form-layout";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import {
  Plus,
  Edit,
  Trash2,
  Search,
  Building2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
} from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge, StatusBadge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { DataTableCard } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { CostCenterLoadNotice } from "@/components/CostCenterLoadNotice";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import {
  costCenterDisplayName,
  costCenterLoadState,
  costCenterPeriodLabel,
  filterCostCenters,
} from "@/lib/cost-center-view";
import { exportToExcel, prepareCostCenterProfitabilityForExport } from "@/lib/export";

// ─── Types ───────────────────────────────────────────────

interface CostCenter {
  id: string;
  companyId: string;
  code: string;
  name: string;
  nameAr?: string | null;
  type?: "cost_centre" | "project" | "job";
  description?: string | null;
  parentId?: string | null;
  isActive: boolean;
}

interface CostCenterReport {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
}

interface CostCenterProfitabilityRow {
  costCenterId: string;
  code: string;
  name: string;
  nameAr?: string | null;
  type?: string;
  depth?: number;
  isUnallocated?: boolean;
  rollup?: { totalIncome: number; totalExpenses: number; netIncome: number };
  isActive: boolean;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  lineCount: number;
}

interface CostCenterProfitabilityReport {
  periodStart: string | null;
  periodEnd: string | null;
  costCenters: CostCenterProfitabilityRow[];
  totals: {
    costCenterCount: number;
    activeCostCenterCount: number;
    allocatedLineCount: number;
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
  };
}

// ─── Schemas ─────────────────────────────────────────────

const costCenterFormSchema = z.object({
  code: z.string().min(1, "forms.errors.codeRequired"),
  name: z.string().min(1, "forms.errors.nameRequired"),
  nameAr: z.string().optional().nullable(),
  type: z.enum(["cost_centre", "project", "job"]).default("cost_centre"),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

type CostCenterFormData = z.infer<typeof costCenterFormSchema>;

// ─── Component ───────────────────────────────────────────

/** The default API loader, with the query's abort signal carried to `fetch`. */
function costCenterLoader<T>() {
  return getQueryFn<T>({ on401: "throw" });
}

export default function CostCenters() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCostCenter, setEditingCostCenter] = useState<CostCenter | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);

  // ─── Queries ───────────────────────────────────────────

  const registerQuery = useQuery<CostCenter[]>({
    queryKey: [`/api/companies/${companyId}/cost-centers`],
    queryFn: costCenterLoader<CostCenter[]>(),
    enabled: !!companyId,
  });

  const profitabilityQuery = useQuery<CostCenterProfitabilityReport>({
    queryKey: [`/api/companies/${companyId}/cost-centers/profitability`],
    queryFn: costCenterLoader<CostCenterProfitabilityReport>(),
    enabled: !!companyId,
  });

  const reportQuery = useQuery<CostCenterReport>({
    queryKey: [`/api/companies/${companyId}/cost-centers/${selectedCostCenterId}/report`],
    queryFn: costCenterLoader<CostCenterReport>(),
    enabled: !!companyId && !!selectedCostCenterId,
  });

  // `data` stays undefined until a request has succeeded: counts, totals and empty states are
  // only drawn from it, and it is kept (never mutated) when a later refresh fails.
  const registerData = registerQuery.data;
  const profitabilityReport = profitabilityQuery.data;
  const report = reportQuery.data;
  const costCenters = registerData ?? [];
  const registerState = costCenterLoadState(registerQuery);
  const profitabilityState = costCenterLoadState(profitabilityQuery);
  const reportState = costCenterLoadState(reportQuery);

  // ─── Form ─────────────────────────────────────────────

  const form = useForm<CostCenterFormData>({
    resolver: zodResolver(costCenterFormSchema),
    defaultValues: {
      code: "",
      name: "",
      nameAr: "",
      type: "cost_centre",
      description: "",
      parentId: null,
      isActive: true,
    },
  });

  // ─── Mutations ────────────────────────────────────────

  // Cancel first: invalidating alone reuses a still-running first load, whose pre-write response
  // would then stand in for the fresh one.
  const reloadRegister = async () => {
    const filters = { queryKey: [`/api/companies/${companyId}/cost-centers`], exact: true };
    await queryClient.cancelQueries(filters);
    await queryClient.invalidateQueries(filters);
  };

  const createMutation = useMutation({
    mutationFn: (data: CostCenterFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/cost-centers`, {
        ...data,
        parentId: data.parentId || null,
      }),
    onSuccess: () => {
      void reloadRegister();
      toast({
        title: translateNow("toasts.costCenterCreated"),
        description: translateNow("toasts.costCenterHasBeenAddedSuccessfully"),
      });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CostCenterFormData> }) =>
      apiRequest("PUT", `/api/cost-centers/${id}`, {
        ...data,
        parentId: data.parentId || null,
      }),
    onSuccess: () => {
      void reloadRegister();
      toast({
        title: translateNow("toasts.costCenterUpdated"),
        description: translateNow("toasts.costCenterDetailsHaveBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingCostCenter(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cost-centers/${id}`),
    onSuccess: () => {
      void reloadRegister();
      if (selectedCostCenterId) {
        setSelectedCostCenterId(null);
      }
      toast({
        title: translateNow("toasts.costCenterDeleted"),
        description: translateNow("toasts.costCenterHasBeenRemoved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingCostCenter(null);
    form.reset({
      code: "",
      name: "",
      nameAr: "",
      type: "cost_centre",
      description: "",
      parentId: null,
      isActive: true,
    });
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (costCenter: CostCenter) => {
    setEditingCostCenter(costCenter);
    form.reset({
      code: costCenter.code,
      name: costCenter.name,
      nameAr: costCenter.nameAr || "",
      type: costCenter.type ?? "cost_centre",
      description: costCenter.description || "",
      parentId: costCenter.parentId || null,
      isActive: costCenter.isActive,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (data: CostCenterFormData) => {
    if (editingCostCenter) {
      updateMutation.mutate({ id: editingCostCenter.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleExportCostCenterProfitability = async () => {
    if (!profitabilityReport) {
      toast({
        title: translateNow("toasts.noReportData"),
        description: translateNow("toasts.costCenterPLIsStillLoading"),
        variant: "destructive",
      });
      return;
    }

    try {
      await exportToExcel(
        [prepareCostCenterProfitabilityForExport(profitabilityReport)],
        `cost_center_pnl_${new Date().toISOString().slice(0, 10)}`
      );
      toast({
        title: translateNow("toasts.reportExported2"),
        description: translateNow("toasts.costCenterPLHasBeenDownloaded"),
      });
    } catch (error) {
      toast({
        title: translateNow("toasts.exportFailed"),
        description:
          error instanceof Error ? error.message : translateNow("toasts.unableExportCostCenterPl"),
        variant: "destructive",
      });
    }
  };

  // ─── Helpers ──────────────────────────────────────────

  const getParentName = (parentId: string | null | undefined): string => {
    if (!parentId) return "-";
    const parent = costCenters.find((cc) => cc.id === parentId);
    return parent ? costCenterDisplayName(parent, locale) : "-";
  };

  const getAvailableParents = (): CostCenter[] => {
    if (!editingCostCenter) return costCenters;
    return costCenters.filter((cc) => cc.id !== editingCostCenter.id);
  };

  const filteredCostCenters = filterCostCenters(costCenters, searchQuery);

  const activeCount = costCenters.filter((cc) => cc.isActive).length;
  const inactiveCount = costCenters.filter((cc) => !cc.isActive).length;
  const selectedCostCenter = costCenters.find((cc) => cc.id === selectedCostCenterId);
  const profitabilityRows = profitabilityReport?.costCenters ?? [];
  const profitabilityTotals = profitabilityReport?.totals;
  // Without a report, no period is known: do not claim "all posted periods".
  const profitabilityPeriodLabel = profitabilityReport
    ? costCenterPeriodLabel(profitabilityReport.periodStart, profitabilityReport.periodEnd, {
        beginning: t["screens.ccPeriodBeginning"],
        today: t["screens.ccPeriodToday"],
        range: t["screens.ccPeriodRange"],
        allPeriods: t["costCenters.allPostedPeriods"],
      })
    : profitabilityState === "error"
      ? t["screens.ccPeriodUnavailable"]
      : t["screens.ccPeriodUnknown"];

  if (!canAccess("costCenters")) {
    return <UpgradePrompt feature="costCenters" requiredTier={getRequiredTier("costCenters")} />;
  }

  if (isLoadingCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // The queries stay disabled without a company, so there is nothing to wait for.
  if (!companyId) {
    return <EmptyState icon={Building2} title={t["screens.noCompanySelected"]} />;
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["screens.ccEyebrow"]}
        title={t["screens.costCenters"]}
        description={t["screens.costCentersDescription"]}
        backHref="/reports"
        backLabel={locale === "ar" ? "العودة إلى التقارير" : t["reportCenter.backToReports"]}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExportCostCenterProfitability}
              disabled={!profitabilityReport}
            >
              <Download aria-hidden />
              <T k="pages.export" />
            </Button>
            <Button onClick={handleOpenCreateDialog}>
              <Plus aria-hidden />
              <T k="pageLabels.addCostCenter" />
            </Button>
          </>
        }
      />

      {/* P&L by cost center. Spec 2.6: hidden until the first cost center exists, so an
          empty company sees no KPI row of zeros above the empty register. */}
      {(!registerData || registerData.length > 0) && (
        <section className="space-y-4" aria-labelledby="cc-pl-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 id="cc-pl-title" className="text-h2 text-foreground">
                <T k="pageLabels.costCenterPAndL" />
              </h2>
              <p className="mt-1 text-small text-muted-foreground">
                {formatMessage(t["screens.costCenterPlBasis"], {
                  period: profitabilityPeriodLabel,
                })}
              </p>
            </div>
            <Badge variant="neutral">
              <T k="pageLabels.accrualBasis" />
            </Badge>
          </div>
          {(profitabilityTotals || profitabilityState === "pending") && (
            <div className="mobile-keep-cols grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                testId="cost-center-stat-active"
                label={t["pageLabels.activeCenters"]}
                loading={!profitabilityTotals}
                value={
                  profitabilityTotals && (
                    <span className="tabular-nums">
                      {profitabilityTotals.activeCostCenterCount}/
                      {profitabilityTotals.costCenterCount}
                    </span>
                  )
                }
              />
              <StatCard
                testId="cost-center-stat-income"
                label={t["pages.income"]}
                loading={!profitabilityTotals}
                value={profitabilityTotals && <Money amount={profitabilityTotals.totalIncome} />}
              />
              <StatCard
                label={t["pages.expenses"]}
                loading={!profitabilityTotals}
                value={profitabilityTotals && <Money amount={profitabilityTotals.totalExpenses} />}
              />
              <StatCard
                label={t["pageLabels.netIncome"]}
                loading={!profitabilityTotals}
                value={
                  profitabilityTotals && (
                    <Money amount={profitabilityTotals.netIncome} tone="auto" />
                  )
                }
              />
            </div>
          )}
          <DataTableCard testId="cost-center-pl">
            <CostCenterLoadNotice
              state={profitabilityState}
              hasData={!!profitabilityReport}
              errorTitle={t["screens.ccPlError"]}
              errorBody={t["screens.ccLoadErrorBody"]}
              onRetry={() => void profitabilityQuery.refetch()}
              testId="cost-center-pl-notice"
            />
            {!profitabilityReport && profitabilityState === "pending" && <TableSkeleton />}
            {profitabilityReport && profitabilityRows.length === 0 && (
              <EmptyState
                compact
                icon={Building2}
                title={t["pageLabels.noCostCenterAllocationsHaveBeenPostedYet"]}
              />
            )}
            {profitabilityRows.length > 0 && (
              <Table className="row-cards">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["screens.code"]}</TableHead>
                    <TableHead className="w-full">
                      <T k="pageLabels.costCenter" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.status" />
                    </TableHead>
                    <TableHead data-numeric="">
                      <T k="pages.income" />
                    </TableHead>
                    <TableHead data-numeric="">
                      <T k="pages.expenses" />
                    </TableHead>
                    <TableHead data-numeric="">
                      <T k="pages.netIncome" />
                    </TableHead>
                    <TableHead data-numeric="">{t["screens.ccRollup"]}</TableHead>
                    <TableHead data-numeric="">{t["screens.ccLines"]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profitabilityRows.map((row) => (
                    <TableRow
                      key={row.costCenterId}
                      className={row.isUnallocated ? "bg-surface-sunken/60" : undefined}
                    >
                      <TableCell
                        data-nowrap=""
                        data-cell="meta"
                        className="tabular-nums text-muted-foreground"
                      >
                        {row.code}
                      </TableCell>
                      <TableCell
                        data-truncate=""
                        data-cell="title"
                        className={cn("font-medium", row.isUnallocated && "text-muted-foreground")}
                        style={{ paddingInlineStart: `${(row.depth ?? 0) * 16 + 16}px` }}
                      >
                        <span dir="auto">
                          {row.isUnallocated
                            ? t["screens.ccUnallocated"]
                            : locale === "ar" && row.nameAr
                              ? row.nameAr
                              : row.name}
                        </span>
                        {row.type && row.type !== "cost_centre" && !row.isUnallocated && (
                          <Badge variant="outline" className="ms-2">
                            {row.type === "project"
                              ? t["screens.ccTypeProject"]
                              : t["screens.ccTypeJob"]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell data-nowrap="" data-cell="status">
                        {!row.isUnallocated && (
                          <StatusBadge status={row.isActive ? "active" : "inactive"} />
                        )}
                      </TableCell>
                      <MoneyCell
                        amount={row.totalIncome}
                        showCurrency={false}
                        className="text-muted-foreground"
                      />
                      <MoneyCell
                        amount={row.totalExpenses}
                        showCurrency={false}
                        className="text-muted-foreground"
                      />
                      <MoneyCell
                        amount={row.netIncome}
                        tone="auto"
                        className="font-medium"
                        data-cell="amount"
                      />
                      <TableCell data-numeric="" className="text-muted-foreground">
                        {row.rollup ? (
                          <Money amount={row.rollup.netIncome} showCurrency={false} />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell data-numeric="" className="text-muted-foreground">
                        {row.lineCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DataTableCard>
        </section>
      )}

      {/* Register */}
      <section className="space-y-4" aria-labelledby="cc-register-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="cc-register-title" className="text-h2 text-foreground">
              {t["screens.costCenterRegister"]}
            </h2>
            {registerData && (
              <p className="mt-1 text-small text-muted-foreground" data-testid="cost-center-counts">
                {formatMessage(t["screens.costCenterCounts"], {
                  total: costCenters.length,
                  active: activeCount,
                  inactive: inactiveCount,
                })}
              </p>
            )}
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder={t["screens.searchCostCenters"]}
              aria-label={t["screens.searchCostCenters"]}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 ps-9"
            />
          </div>
        </div>
        <DataTableCard testId="cost-center-register">
          <CostCenterLoadNotice
            state={registerState}
            hasData={!!registerData}
            errorTitle={t["screens.ccRegisterError"]}
            errorBody={t["screens.ccLoadErrorBody"]}
            onRetry={() => void registerQuery.refetch()}
            testId="cost-center-register-notice"
          />
          {!registerData && registerState === "pending" && <TableSkeleton />}
          {registerData && filteredCostCenters.length === 0 && (
            <EmptyState
              compact
              icon={Building2}
              title={
                searchQuery.trim() ? t["screens.noCostCenterMatch"] : t["screens.noCostCenters"]
              }
              action={
                searchQuery.trim()
                  ? undefined
                  : { label: t["pageLabels.addCostCenter"], onClick: handleOpenCreateDialog }
              }
            />
          )}
          {filteredCostCenters.length > 0 && (
            <Table className="row-cards">
              <TableHeader>
                <TableRow>
                  <TableHead>{t["screens.code"]}</TableHead>
                  <TableHead className="w-full">{t["pages.contactsColName"]}</TableHead>
                  <TableHead>
                    <T k="pages.description" />
                  </TableHead>
                  <TableHead>
                    <T k="consolidation.parent" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">
                      <T k="pages.actions" />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCostCenters.map((center) => (
                  <TableRow
                    key={center.id}
                    data-state={selectedCostCenterId === center.id ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() =>
                      setSelectedCostCenterId(center.id === selectedCostCenterId ? null : center.id)
                    }
                  >
                    <TableCell
                      data-nowrap=""
                      data-cell="meta"
                      className="tabular-nums text-muted-foreground"
                    >
                      {center.code}
                    </TableCell>
                    <TableCell
                      data-truncate=""
                      data-cell="title"
                      dir="auto"
                      className="font-medium"
                    >
                      {costCenterDisplayName(center, locale)}
                    </TableCell>
                    <TableCell data-truncate="" className="text-muted-foreground">
                      {center.description || "—"}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="meta" className="text-muted-foreground">
                      {getParentName(center.parentId)}
                    </TableCell>
                    <TableCell data-nowrap="" data-cell="status">
                      <StatusBadge status={center.isActive ? "active" : "inactive"} />
                    </TableCell>
                    <TableCell data-cell="actions" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        collapseOnMobile
                        menu={
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => {
                              if (window.confirm(t["screens.confirmDeleteCostCenter"])) {
                                deleteMutation.mutate(center.id);
                              }
                            }}
                          >
                            <Trash2 aria-hidden />
                            {t.delete}
                          </DropdownMenuItem>
                        }
                      >
                        <RowActionButton
                          label={t.edit}
                          icon={Edit}
                          onClick={() => handleOpenEditDialog(center)}
                        />
                      </RowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DataTableCard>
      </section>

      {/* Selected cost center P&L */}
      {selectedCostCenter && (
        <SectionCard
          title={
            <>
              {t["screens.plSummary"]} ·{" "}
              <span dir="auto">{costCenterDisplayName(selectedCostCenter, locale)}</span>{" "}
              <span className="tabular-nums text-muted-foreground">
                ({selectedCostCenter.code})
              </span>
            </>
          }
        >
          <CostCenterLoadNotice
            state={reportState}
            hasData={!!report}
            errorTitle={t["screens.ccReportError"]}
            errorBody={t["screens.ccLoadErrorBody"]}
            onRetry={() => void reportQuery.refetch()}
            testId="cost-center-report-notice"
            className="px-0"
          />
          {report && (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="cost-center-report">
              <div>
                <dt className="flex items-center gap-1.5 text-small text-muted-foreground">
                  <TrendingUp className="h-4 w-4" aria-hidden />
                  <T k="pages.income" />
                </dt>
                <dd className="mt-1 text-h3 font-semibold">
                  <Money amount={report.totalIncome} />
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-small text-muted-foreground">
                  <TrendingDown className="h-4 w-4" aria-hidden />
                  <T k="pages.expenses" />
                </dt>
                <dd className="mt-1 text-h3 font-semibold">
                  <Money amount={report.totalExpenses} />
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-small text-muted-foreground">
                  <DollarSign className="h-4 w-4" aria-hidden />
                  {t["screens.net"]}
                </dt>
                <dd className="mt-1 text-h3 font-semibold">
                  <Money amount={report.netIncome} tone="auto" />
                </dd>
              </div>
            </dl>
          )}
        </SectionCard>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md" data-testid="dialog-cost-center-form">
          <DialogHeader>
            <DialogTitle>
              {editingCostCenter ? t["screens.editCostCenter"] : t["pageLabels.addCostCenter"]}
            </DialogTitle>
            <DialogDescription>
              {editingCostCenter
                ? t["screens.costCenterDialogEditDesc"]
                : t["screens.costCenterDialogNewDesc"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} noValidate className="space-y-6">
              <FormErrorSummary />
              <FormSection title={t["forms.section.costCenter"]}>
                <FormGrid>
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.ccCode"]}</FormLabel>
                        <FormControl>
                          <Input ltr placeholder="CC-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["screens.ccName"]}</FormLabel>
                        <FormControl>
                          <Input dir="auto" placeholder={t["screens.cc2Marketing"]} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nameAr"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["screens.ccNameAr"]}</FormLabel>
                        <FormControl>
                          <Input dir="rtl" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t["screens.ccType"]}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? "cost_centre"}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="cost_centre">
                              {t["screens.ccTypeCostCentre"]}
                            </SelectItem>
                            <SelectItem value="project">{t["screens.ccTypeProject"]}</SelectItem>
                            <SelectItem value="job">{t["screens.ccTypeJob"]}</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="parentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <T k="pageLabels.parentCostCenter" />
                        </FormLabel>
                        <Select
                          onValueChange={(value) =>
                            field.onChange(value === "_none" ? null : value)
                          }
                          value={field.value || "_none"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t["screens.cc2NoneTopLevel"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="_none">{t["screens.cc2NoneTopLevel"]}</SelectItem>
                            {getAvailableParents().map((parent) => (
                              <SelectItem key={parent.id} value={parent.id}>
                                {parent.code} — {costCenterDisplayName(parent, locale)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className={formSpanFull}>
                        <FormLabel>
                          <T k="pages.description" />
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t["screens.cc2OptionalDescriptionForThisCostCenter"]}
                            rows={2}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-full flex items-center justify-between gap-4 space-y-0 rounded-lg bg-surface-sunken/60 p-4">
                        <div className="space-y-0.5">
                          <FormLabel>
                            <T k="pages.active" />
                          </FormLabel>
                          <p className="text-caption text-muted-foreground">
                            <T k="pageLabels.inactiveCostCentersCannotReceiveNewTransactions" />
                          </p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  <T k="pages.cancel" />
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t["forms.saving"]
                    : editingCostCenter
                      ? t["forms.costCenter.update"]
                      : t["pageLabels.addCostCenter"]}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
