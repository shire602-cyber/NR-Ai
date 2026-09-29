import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportToExcel, prepareCostCenterProfitabilityForExport } from "@/lib/export";
import { formatCurrency } from "@/lib/format";
import { messages as pageMessages } from "./CostCenters.i18n";

// ─── Types ───────────────────────────────────────────────

interface CostCenter {
  id: string;
  companyId: string;
  code: string;
  name: string;
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
  code: z.string().min(1, pageMessages.marker("codeIsRequired")),
  name: z.string().min(1, pageMessages.marker("nameIsRequired")),
  description: z.string().optional(),
  parentId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

type CostCenterFormData = z.infer<typeof costCenterFormSchema>;

// ─── Component ───────────────────────────────────────────

export default function CostCenters() {
  const tr = pageMessages.useT();

  const { locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCostCenter, setEditingCostCenter] = useState<CostCenter | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);

  // ─── Queries ───────────────────────────────────────────

  const { data: costCenters = [], isLoading } = useQuery<CostCenter[]>({
    queryKey: [`/api/companies/${companyId}/cost-centers`],
    enabled: !!companyId,
  });

  const { data: profitabilityReport, isLoading: isLoadingProfitability } =
    useQuery<CostCenterProfitabilityReport>({
      queryKey: [`/api/companies/${companyId}/cost-centers/profitability`],
      enabled: !!companyId,
    });

  const { data: report } = useQuery<CostCenterReport>({
    queryKey: [`/api/companies/${companyId}/cost-centers/${selectedCostCenterId}/report`],
    enabled: !!companyId && !!selectedCostCenterId,
  });

  // ─── Form ─────────────────────────────────────────────

  const form = useForm<CostCenterFormData>({
    resolver: zodResolver(costCenterFormSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      parentId: null,
      isActive: true,
    },
  });

  // ─── Mutations ────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: CostCenterFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/cost-centers`, {
        ...data,
        parentId: data.parentId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
      toast({
        title: tr("costCenterCreated"),
        description: tr("costCenterHasBeenAddedSuccessfully"),
      });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CostCenterFormData> }) =>
      apiRequest("PUT", `/api/cost-centers/${id}`, {
        ...data,
        parentId: data.parentId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
      toast({
        title: tr("costCenterUpdated"),
        description: tr("costCenterDetailsHaveBeenUpdated"),
      });
      setDialogOpen(false);
      setEditingCostCenter(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cost-centers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/cost-centers`] });
      if (selectedCostCenterId) {
        setSelectedCostCenterId(null);
      }
      toast({ title: tr("costCenterDeleted"), description: tr("costCenterHasBeenRemoved") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingCostCenter(null);
    form.reset({
      code: "",
      name: "",
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
        title: tr("noReportData"),
        description: tr("costCenterPLIsStill"),
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
        title: tr("reportExported"),
        description: tr("costCenterPLHasBeen"),
      });
    } catch (error) {
      toast({
        title: tr("exportFailed"),
        description: error instanceof Error ? error.message : tr("unableToExportCostCenterP"),
        variant: "destructive",
      });
    }
  };

  // ─── Helpers ──────────────────────────────────────────

  const getParentName = (parentId: string | null | undefined): string => {
    if (!parentId) return "-";
    const parent = costCenters.find((cc) => cc.id === parentId);
    return parent ? parent.name : "-";
  };

  const getAvailableParents = (): CostCenter[] => {
    if (!editingCostCenter) return costCenters;
    return costCenters.filter((cc) => cc.id !== editingCostCenter.id);
  };

  const filteredCostCenters = costCenters.filter((cc) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      cc.code.toLowerCase().includes(q) ||
      cc.name.toLowerCase().includes(q) ||
      (cc.description?.toLowerCase().includes(q) ?? false)
    );
  });

  const activeCount = costCenters.filter((cc) => cc.isActive).length;
  const inactiveCount = costCenters.filter((cc) => !cc.isActive).length;
  const selectedCostCenter = costCenters.find((cc) => cc.id === selectedCostCenterId);
  const profitabilityRows = profitabilityReport?.costCenters ?? [];
  const profitabilityTotals = profitabilityReport?.totals ?? {
    costCenterCount: 0,
    activeCostCenterCount: 0,
    allocatedLineCount: 0,
    totalIncome: 0,
    totalExpenses: 0,
    netIncome: 0,
  };
  const profitabilityPeriodLabel =
    profitabilityReport?.periodStart || profitabilityReport?.periodEnd
      ? `${profitabilityReport.periodStart ?? "Beginning"} to ${
          profitabilityReport.periodEnd ?? "today"
        }`
      : tr("allPostedPeriods");

  if (!canAccess("costCenters")) {
    return <UpgradePrompt feature="costCenters" requiredTier={getRequiredTier("costCenters")} />;
  }

  if (isLoadingCompany || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow={tr("accounting")}
        title={tr("costCenters")}
        description={tr("manageCostCentersForDepartmentalAccounting")}
        backHref="/reports"
        backLabel={tr("backToReports")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExportCostCenterProfitability}
              disabled={isLoadingProfitability || !profitabilityReport}
            >
              <Download className="me-2 h-4 w-4" />
              {tr("export")}
            </Button>
            <Button onClick={handleOpenCreateDialog}>
              <Plus className="me-2 h-4 w-4" />
              {tr("addCostCenter")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{tr("costCenterPL")}</CardTitle>
            <CardDescription>
              {tr("periodSourceBasisPostedJournalLines", { profitabilityPeriodLabel })}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="w-fit">
            {tr("accrualBasis")}
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoadingProfitability ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tr("activeCenters")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {profitabilityTotals.activeCostCenterCount}/
                    {profitabilityTotals.costCenterCount}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tr("income")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-success">
                    {formatCurrency(profitabilityTotals.totalIncome, "AED", locale)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tr("expenses")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-destructive">
                    {formatCurrency(profitabilityTotals.totalExpenses, "AED", locale)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tr("netIncome")}
                  </p>
                  <p
                    className={`mt-1 text-2xl font-semibold ${
                      profitabilityTotals.netIncome >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {formatCurrency(profitabilityTotals.netIncome, "AED", locale)}
                  </p>
                </div>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("code")}</TableHead>
                      <TableHead>{tr("costCenter")}</TableHead>
                      <TableHead>{tr("status")}</TableHead>
                      <TableHead className="text-end">{tr("income")}</TableHead>
                      <TableHead className="text-end">{tr("expenses")}</TableHead>
                      <TableHead className="text-end">{tr("netIncome2")}</TableHead>
                      <TableHead className="text-end">{tr("lines")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profitabilityRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                          {tr("noCostCenterAllocationsHaveBeen")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      profitabilityRows.map((row) => (
                        <TableRow key={row.costCenterId}>
                          <TableCell className="font-mono text-sm">{row.code}</TableCell>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>
                            <Badge variant={row.isActive ? "default" : "secondary"}>
                              {row.isActive ? tr("active") : tr("inactive")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-end font-mono">
                            {formatCurrency(row.totalIncome, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end font-mono">
                            {formatCurrency(row.totalExpenses, "AED", locale)}
                          </TableCell>
                          <TableCell
                            className={`text-end font-mono ${
                              row.netIncome >= 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {formatCurrency(row.netIncome, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end font-mono">{row.lineCount}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("totalCostCenters")}</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{costCenters.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("active")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tr("inactive")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{inactiveCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tr("searchCostCenters")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-10"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("code")}</TableHead>
                <TableHead>{tr("name")}</TableHead>
                <TableHead>{tr("description")}</TableHead>
                <TableHead>{tr("parent")}</TableHead>
                <TableHead>{tr("status")}</TableHead>
                <TableHead className="text-end">{tr("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCostCenters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {searchQuery
                      ? tr("noCostCentersMatchYourSearch")
                      : tr("noCostCentersYetAddYour")}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCostCenters.map((cc) => (
                  <TableRow
                    key={cc.id}
                    className={
                      selectedCostCenterId === cc.id
                        ? "bg-muted/50"
                        : "cursor-pointer hover:bg-muted/30"
                    }
                    onClick={() =>
                      setSelectedCostCenterId(cc.id === selectedCostCenterId ? null : cc.id)
                    }
                  >
                    <TableCell className="font-mono text-sm">{cc.code}</TableCell>
                    <TableCell className="font-medium">{cc.name}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {cc.description || "-"}
                    </TableCell>
                    <TableCell>{getParentName(cc.parentId)}</TableCell>
                    <TableCell>
                      {cc.isActive ? (
                        <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
                          {tr("active")}
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-foreground hover:bg-muted">
                          {tr("inactive")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditDialog(cc);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(tr("areYouSureYouWantTo"))) {
                              deleteMutation.mutate(cc.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cost Center P&L Report */}
      {selectedCostCenter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {tr("pLSummary", { name: selectedCostCenter.name, code: selectedCostCenter.code })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-success-subtle border-success/30">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-success">
                      {tr("income")}
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-success" />
                  </CardHeader>
                  <CardContent>
                    <div dir="ltr" className="text-2xl font-bold text-success font-mono">
                      {formatCurrency(report.totalIncome ?? 0, "AED", locale)}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-danger-subtle border-destructive/30">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-destructive">
                      {tr("expenses")}
                    </CardTitle>
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  </CardHeader>
                  <CardContent>
                    <div dir="ltr" className="text-2xl font-bold text-destructive font-mono">
                      {formatCurrency(report.totalExpenses ?? 0, "AED", locale)}
                    </div>
                  </CardContent>
                </Card>
                <Card
                  className={
                    (report.netIncome ?? 0) >= 0
                      ? "bg-info-subtle border-info/30"
                      : "bg-warning-subtle border-warning/30"
                  }
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle
                      className={`text-sm font-medium ${(report.netIncome ?? 0) >= 0 ? "text-info" : "text-warning"}`}
                    >
                      {tr("net")}
                    </CardTitle>
                    <DollarSign
                      className={`h-4 w-4 ${(report.netIncome ?? 0) >= 0 ? "text-info" : "text-warning"}`}
                    />
                  </CardHeader>
                  <CardContent>
                    <div
                      dir="ltr"
                      className={`text-2xl font-bold font-mono ${(report.netIncome ?? 0) >= 0 ? "text-info" : "text-warning"}`}
                    >
                      {formatCurrency(report.netIncome ?? 0, "AED", locale)}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{tr("noReportDataAvailableForThis")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingCostCenter ? tr("editCostCenter") : tr("addCostCenter")}
            </DialogTitle>
            <DialogDescription>
              {editingCostCenter
                ? tr("updateCostCenterDetailsBelow")
                : tr("fillInTheDetailsToCreate")}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("code2")}</FormLabel>
                      <FormControl>
                        <Input placeholder="CC-001" {...field} />
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
                      <FormLabel>{tr("name2")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("marketing")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tr("optionalDescriptionForThisCostCenter")}
                        rows={3}
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
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("parentCostCenter")}</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "_none" ? null : value)}
                      value={field.value || "_none"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tr("noneTopLevel")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="_none">{tr("noneTopLevel")}</SelectItem>
                        {getAvailableParents().map((parent) => (
                          <SelectItem key={parent.id} value={parent.id}>
                            {parent.code} — {parent.name}
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
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>{tr("active")}</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        {tr("inactiveCostCentersCannotReceiveNew")}
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <div className="me-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                  {editingCostCenter ? tr("updateCostCenter") : tr("addCostCenter")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
