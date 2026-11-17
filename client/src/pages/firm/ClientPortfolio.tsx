import { T } from "@/components/layout/T";
import { FileDrop } from "@/components/ui/file-drop";
import { PageHeader } from "@/components/ui/page-header";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Building2,
  Plus,
  Search,
  LayoutGrid,
  List,
  ChevronRight,
  Users,
  Calendar,
  BookOpen,
  Upload,
  AlertTriangle,
  Receipt,
  FolderOpen,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  type ClientServiceCode,
} from "@shared/client-services";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import type {
  BookkeeperDashboard,
  ClientWithStats,
  FirmOverview,
  ImportResult,
} from "./portfolio/types";
import {
  clientNeedsAttention,
  formatAed,
  formatDays,
  hasClientService,
  ownerPreview,
  priorityLabel,
  vatDueSoon,
} from "./portfolio/helpers";
import { PriorityBadge, ServiceScopeBadges, StatusBadge } from "./portfolio/badges";
import { OperationsBriefDialog } from "./portfolio/OperationsBriefDialog";
import { BookkeeperCommandCenter } from "./portfolio/BookkeeperCommandCenter";
import { RevenueGrowthPanel } from "./portfolio/RevenueGrowthPanel";
import { VatWorkspaceDialog, VatWorkspacePanel } from "./portfolio/VatWorkspace";
import { useFirmText } from "./portfolio/text";

interface AddClientFormData {
  name: string;
  trnVatNumber: string;
  industry: string;
  legalStructure: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  emirate: string;
  vatFilingFrequency: string;
  vatPeriodStartMonth: string;
  fiscalYearStartMonth: string;
  corporateTaxId: string;
  serviceScope: ClientServiceCode[];
}

const emptyForm: AddClientFormData = {
  name: "",
  trnVatNumber: "",
  industry: "",
  legalStructure: "",
  contactEmail: "",
  contactPhone: "",
  businessAddress: "",
  emirate: "dubai",
  vatFilingFrequency: "quarterly",
  vatPeriodStartMonth: "auto",
  fiscalYearStartMonth: "1",
  corporateTaxId: "",
  serviceScope: [...DEFAULT_CLIENT_SERVICE_CODES],
};

type QuickFilter =
  | "all"
  | "critical"
  | "attention"
  | "vat-due"
  | "vat-group-1"
  | "vat-group-2"
  | "vat-group-3"
  | "close-blocked"
  | "unassigned"
  | "no-docs";

const VAT_GROUP_FILTERS: Array<{
  filter: QuickFilter;
  cohortKey: string;
  periodStartMonth: number;
  label: string;
}> = [
  {
    filter: "vat-group-1",
    cohortKey: "jan_apr_jul_oct",
    periodStartMonth: 1,
    label: "Group 1",
  },
  {
    filter: "vat-group-2",
    cohortKey: "feb_may_aug_nov",
    periodStartMonth: 2,
    label: "Group 2",
  },
  {
    filter: "vat-group-3",
    cohortKey: "mar_jun_sep_dec",
    periodStartMonth: 3,
    label: "Group 3",
  },
];

const vatGroupFilterByQuickFilter = new Map(
  VAT_GROUP_FILTERS.map((filter) => [filter.filter, filter])
);

export default function ClientPortfolio() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { b, fx, fdShort } = useFirmText();
  const { setActiveClientCompany } = useActiveCompany();
  const [view, setView] = useState<"card" | "table">("card");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [briefClientId, setBriefClientId] = useState<string | null>(null);
  const [vatWorkspaceClientId, setVatWorkspaceClientId] = useState<string | null>(null);
  const [form, setForm] = useState<AddClientFormData>(emptyForm);

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ["/api/firm/clients"],
  });

  const { data: overview } = useQuery<FirmOverview>({
    queryKey: ["/api/firm/overview"],
  });

  const { data: bookkeeperDashboard } = useQuery<BookkeeperDashboard>({
    queryKey: ["/api/firm/bookkeeper-dashboard"],
  });

  const bookkeeperByClientId = useMemo(() => {
    return new Map(
      (bookkeeperDashboard?.clients ?? []).map((client) => [client.companyId, client])
    );
  }, [bookkeeperDashboard]);

  const briefClient = useMemo(() => {
    return briefClientId ? bookkeeperByClientId.get(briefClientId) : undefined;
  }, [bookkeeperByClientId, briefClientId]);

  const vatWorkspaceClient = useMemo(() => {
    return vatWorkspaceClientId
      ? clients.find((client) => client.id === vatWorkspaceClientId)
      : undefined;
  }, [clients, vatWorkspaceClientId]);

  const vatWorkspaceOps = useMemo(() => {
    return vatWorkspaceClientId ? bookkeeperByClientId.get(vatWorkspaceClientId) : undefined;
  }, [bookkeeperByClientId, vatWorkspaceClientId]);

  const createMutation = useMutation({
    mutationFn: (data: AddClientFormData) => apiRequest("POST", "/api/firm/clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: t["clientPortfolio.clientCreatedSuccessfully"] });
      setAddOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreateClient"),
        description: e?.message,
      });
    },
  });

  const switchMutation = useMutation({
    mutationFn: (companyId: string) => apiRequest("POST", `/api/firm/clients/${companyId}/switch`),
    onSuccess: (_, companyId) => {
      setActiveClientCompany(companyId);
      // Force a refetch of /api/companies so the active company is in cache.
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      navigate("/dashboard");
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotOpenClientBooks"),
        description: e?.message,
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Build base64 in chunks to avoid call-stack overflow on bigger files.
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const fileData = btoa(binary);
      return apiRequest("POST", "/api/firm/clients/import", { fileData }) as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({
        title: formatMessage(translateNow("toasts.importedClients"), {
          count: result.created.length,
        }),
        description:
          result.errors.length > 0
            ? formatMessage(translateNow("toasts.errorsSeeDetails"), {
                count: result.errors.length,
              })
            : undefined,
      });
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.importFailed2"),
        description: e?.message,
      });
    },
  });

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const ops = bookkeeperByClientId.get(c.id);
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.trnVatNumber || "").toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      switch (quickFilter) {
        case "critical":
          return ops?.priority === "critical";
        case "attention":
          return ops
            ? ops.priority === "attention" || ops.priority === "critical"
            : clientNeedsAttention(c);
        case "vat-due":
          return ops
            ? hasClientService(ops, "vat") &&
                ops.vat.status !== "filed" &&
                ops.vat.daysTilDue !== null &&
                ops.vat.daysTilDue <= 28
            : hasClientService(c, "vat") && vatDueSoon(c);
        case "vat-group-1":
        case "vat-group-2":
        case "vat-group-3": {
          const groupFilter = vatGroupFilterByQuickFilter.get(quickFilter);
          if (!groupFilter) return true;
          return ops
            ? hasClientService(ops, "vat") && ops.vat.cohortKey === groupFilter.cohortKey
            : hasClientService(c, "vat") && c.vatPeriodStartMonth === groupFilter.periodStartMonth;
        }
        case "close-blocked":
          return ops
            ? hasClientService(ops, "bookkeeping") && ops.bookkeeping.status !== "on_track"
            : false;
        case "unassigned":
          return ops ? ops.assignedStaff.length === 0 : c.assignedStaff.length === 0;
        case "no-docs":
          return c.invoiceCount === 0 && !c.lastReceiptDate;
        case "all":
        default:
          return true;
      }
    });
  }, [bookkeeperByClientId, clients, search, quickFilter]);

  const handleOpenBooks = (id: string) => {
    switchMutation.mutate(id);
  };

  const handleViewProfile = (id: string) => {
    navigate(`/firm/clients/${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">
          <T k="pages.loadingClientPortfolio" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firm"
        title={<T k="pages.clientPortfolio" />}
        description={formatMessage(
          clients.length === 1 ? t["firm.clientsManagedOne"] : t["firm.clientsManagedMany"],
          { count: clients.length }
        )}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setImportResult(null);
                setImportFile(null);
                setImportOpen(true);
              }}
            >
              <Upload className="w-4 h-4 me-2" aria-hidden />
              <T k="pages.importClients" />
            </Button>
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-client">
              <Plus className="w-4 h-4 me-2" aria-hidden />
              <T k="pages.addClient" />
            </Button>
          </>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card data-testid="card-total-clients">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                <T k="pages.totalClients" />
              </p>
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-h1 font-semibold tabular-nums">
              {overview?.totalClients ?? clients.length}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-vat-due">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{t["firm.vatDue30d"]}</p>
              <Calendar className="w-4 h-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-1 text-h1 font-semibold tabular-nums">
              {overview?.vatDueThisMonth ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-overdue-ar">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                <T k="pages.overdueAr" />
              </p>
              <Receipt className="w-4 h-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-1 text-h1 font-semibold tabular-nums">
              {formatAed(overview?.overdueAr ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-attention">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                <T k="pages.needsAttention" />
              </p>
              <AlertTriangle className="w-4 h-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-1 text-h1 font-semibold tabular-nums">
              {overview?.needsAttention ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <BookkeeperCommandCenter
        dashboard={bookkeeperDashboard}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
        onOpenBrief={setBriefClientId}
        onManageStaff={() => navigate("/firm/staff")}
      />

      <RevenueGrowthPanel onOpenClient={handleViewProfile} />

      <VatWorkspacePanel
        dashboard={bookkeeperDashboard}
        clients={clients}
        onOpenWorkspace={setVatWorkspaceClientId}
      />

      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={quickFilter === "all" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("all")}
        >
          {b("All", "الكل")} ({clients.length})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "critical" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("critical")}
          data-testid="filter-critical"
        >
          <AlertTriangle className="w-3.5 h-3.5 me-1.5" />
          {b("Critical", "حرج")} ({bookkeeperDashboard?.summary.critical ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "attention" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("attention")}
          data-testid="filter-attention"
        >
          <AlertTriangle className="w-3.5 h-3.5 me-1.5" />
          {b("Needs Attention", "يحتاج انتباهًا")} (
          {(bookkeeperDashboard?.summary.critical ?? 0) +
            (bookkeeperDashboard?.summary.attention ?? 0)}
          )
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "vat-due" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("vat-due")}
          data-testid="filter-vat-due"
        >
          <Calendar className="w-3.5 h-3.5 me-1.5" />
          {b("VAT Due Soon", "ضريبة قيمة مضافة قريبة الاستحقاق")} (
          {bookkeeperDashboard?.summary.vatDue28Days ?? 0})
        </Button>
        {VAT_GROUP_FILTERS.map((group) => {
          const cohort = bookkeeperDashboard?.vatCohorts?.find(
            (candidate) => candidate.key === group.cohortKey
          );
          return (
            <Button
              key={group.filter}
              size="sm"
              variant={quickFilter === group.filter ? "secondary" : "outline"}
              onClick={() => setQuickFilter(group.filter)}
              data-testid={`filter-${group.filter}`}
            >
              <Calendar className="w-3.5 h-3.5 me-1.5" />
              {b(group.label, group.label.replace("Group", "المجموعة"))} ({cohort?.clientCount ?? 0}
              )
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={quickFilter === "close-blocked" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("close-blocked")}
          data-testid="filter-close-blocked"
        >
          <TrendingUp className="w-3.5 h-3.5 me-1.5" />
          {b("Close Blocked", "إقفال معوق")} ({bookkeeperDashboard?.summary.bookkeepingBlocked ?? 0}
          )
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "unassigned" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("unassigned")}
          data-testid="filter-unassigned"
        >
          <UserCheck className="w-3.5 h-3.5 me-1.5" />
          {b("Unassigned", "غير معيّن")} ({bookkeeperDashboard?.workload?.unassignedClients ?? 0})
        </Button>
        <Button
          size="sm"
          variant={quickFilter === "no-docs" ? "secondary" : "outline"}
          onClick={() => setQuickFilter("no-docs")}
          data-testid="filter-no-docs"
        >
          <FolderOpen className="w-3.5 h-3.5 me-1.5" />
          <T k="pages.missingDocuments" />
        </Button>
      </div>

      {/* Search & view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={b("Search by name or TRN...", "ابحث بالاسم أو رقم التسجيل الضريبي...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
            data-testid="input-client-search"
          />
        </div>
        <div className="flex border rounded-md ms-auto">
          <Button
            variant={view === "card" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-e-none"
            onClick={() => setView("card")}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-s-none"
            onClick={() => setView("table")}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg">
            {clients.length === 0
              ? b("No clients yet", "لا يوجد عملاء بعد")
              : b("No clients match your filters", "لا يوجد عملاء يطابقون عوامل التصفية")}
          </h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {clients.length === 0
              ? b("Add your first client company to get started.", "أضف أول شركة عميل للبدء.")
              : "Try adjusting your search or quick filter."}
          </p>
          {clients.length === 0 && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 me-2" />
              <T k="pages.addFirstClient" />
            </Button>
          )}
        </div>
      )}

      {bookkeeperDashboard && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-primary" />
                <T k="pages.portfolioProductionMatrix" />
              </CardTitle>
              <Badge variant="outline">
                {filtered.length} {b("shown", "معروض")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.client" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.owner" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.services" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.priority" />
                  </TableHead>
                  <TableHead>VAT</TableHead>
                  <TableHead>
                    <T k="pages.corporateTax" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.close" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.nextAction2" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 12).map((client) => {
                  const ops = bookkeeperByClientId.get(client.id);
                  return (
                    <TableRow key={`matrix-${client.id}`} className="hover:bg-muted/50">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => handleViewProfile(client.id)}
                          className="font-medium text-start hover:underline"
                        >
                          {client.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {client.trnVatNumber || b("No TRN", "بلا رقم تسجيل ضريبي")}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops
                          ? fx(ownerPreview(ops.assignedStaff.map((staff) => staff.name)))
                          : fx(ownerPreview(client.assignedStaff.map((staff) => staff.name)))}
                      </TableCell>
                      <TableCell>
                        <ServiceScopeBadges
                          services={ops?.serviceScope ?? client.serviceScope}
                          compact
                        />
                      </TableCell>
                      <TableCell>
                        {ops ? (
                          <PriorityBadge priority={ops.priority} />
                        ) : (
                          <StatusBadge
                            active={client.invoiceCount > 0 || !!client.lastReceiptDate}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ops && hasClientService(ops, "vat") ? (
                          <div>
                            <span>
                              {fdShort(ops.vat.dueDate)} · {fx(formatDays(ops.vat.daysTilDue))}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {fx(ops.vat.cohortLabel)}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="outline">
                            <T k="pages.notScoped" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops && hasClientService(ops, "corporate_tax")
                          ? `${fdShort(ops.corporateTax.dueDate)} · ${fx(formatDays(ops.corporateTax.daysTilDue))}`
                          : b("Not scoped", "خارج النطاق")}
                      </TableCell>
                      <TableCell>
                        {ops && hasClientService(ops, "bookkeeping") ? (
                          <div className="min-w-28">
                            <div className="flex items-center justify-between text-xs">
                              <span>{ops.bookkeeping.closeProgress}%</span>
                              <span className="text-muted-foreground">
                                {fx(priorityLabel(ops.bookkeeping.status))}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${ops.bookkeeping.closeProgress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          b("Not scoped", "خارج النطاق")
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2 min-w-64">
                          <p className="text-sm text-muted-foreground truncate">
                            {fx(ops?.nextBestAction) || b("Open client profile", "فتح ملف العميل")}
                          </p>
                          <div className="flex gap-1">
                            {ops && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setBriefClientId(client.id)}
                              >
                                <T k="pages.brief" />
                              </Button>
                            )}
                            {(!ops || hasClientService(ops, "vat")) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setVatWorkspaceClientId(client.id)}
                              >
                                {b("VAT", "ضريبة القيمة المضافة")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenBooks(client.id)}
                              disabled={switchMutation.isPending}
                            >
                              <BookOpen className="w-3.5 h-3.5 me-1" />
                              {b("Open", "فتح")}
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > 12 && (
              <p className="text-xs text-muted-foreground mt-3">
                {b(
                  "Showing the first 12 clients for the selected filter. Use search or table view for the full list.",
                  "تظهر أول 12 عميلًا لعامل التصفية المحدد. استخدم البحث أو عرض الجدول للقائمة الكاملة."
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card view */}
      {view === "card" && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((client) => {
            const ops = bookkeeperByClientId.get(client.id);
            return (
              <Card
                key={client.id}
                className="hover:shadow-md transition-shadow"
                data-testid={`client-card-${client.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{client.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {client.trnVatNumber
                          ? `${b("TRN", "الرقم الضريبي")}: ${client.trnVatNumber}`
                          : b("No TRN registered", "لا يوجد رقم تسجيل ضريبي")}
                      </p>
                      <div className="mt-2">
                        <ServiceScopeBadges
                          services={ops?.serviceScope ?? client.serviceScope}
                          compact
                        />
                      </div>
                    </div>
                    {ops ? (
                      <PriorityBadge priority={ops.priority} />
                    ) : (
                      <StatusBadge active={client.invoiceCount > 0 || !!client.lastReceiptDate} />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ops && (
                    <div className="rounded-md border bg-muted/20 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            <T k="pages.nextAction" />
                          </p>
                          <p className="text-sm font-medium truncate">{fx(ops.nextBestAction)}</p>
                        </div>
                        <span className="text-xs font-medium shrink-0">
                          {ops.bookkeeping.closeProgress}% {b("close", "إقفال")}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${ops.bookkeeping.closeProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Key metrics */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs text-muted-foreground">
                        <T k="pages.outstandingAr" />
                      </p>
                      <p className="font-semibold text-sm mt-0.5">
                        {formatAed(client.outstandingAr)}
                      </p>
                    </div>
                    <div className="bg-muted/40 rounded-md p-2">
                      <p className="text-xs text-muted-foreground">
                        <T k="pages.invoices" />
                      </p>
                      <p className="font-semibold text-sm mt-0.5">{client.invoiceCount}</p>
                    </div>
                  </div>

                  {/* VAT status */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <T k="pages.vatStatus" />
                    </span>
                    {ops && hasClientService(ops, "vat") ? (
                      <PriorityBadge priority={ops.vat.status} />
                    ) : (
                      <Badge variant="outline">
                        <T k="pages.notScoped" />
                      </Badge>
                    )}
                  </div>

                  {ops && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>
                        {hasClientService(ops, "vat")
                          ? `${fx(ops.vat.cohortLabel)} · ${fx(formatDays(ops.vat.daysTilDue))}`
                          : b("VAT not scoped", "ضريبة القيمة المضافة خارج النطاق")}
                      </span>
                      <span>
                        {hasClientService(ops, "corporate_tax")
                          ? `${b("CT", "ضريبة الشركات")} ${fx(formatDays(ops.corporateTax.daysTilDue))}`
                          : b("CT not scoped", "ضريبة الشركات خارج النطاق")}
                      </span>
                    </div>
                  )}

                  {/* Last activity */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      <T k="pages.lastReceipt" />
                    </span>
                    <span>
                      {client.lastReceiptDate
                        ? `${fdShort(client.lastReceiptDate)}, ${new Date(client.lastReceiptDate).getFullYear()}`
                        : b("Never", "أبدًا")}
                    </span>
                  </div>

                  {/* Staff */}
                  {(ops?.assignedStaff.length ?? client.assignedStaff.length) > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="w-3.5 h-3.5" />
                      {ops
                        ? ops.assignedStaff.map((s) => s.name).join(", ")
                        : client.assignedStaff.map((s) => s.name).join(", ")}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {ops && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBriefClientId(client.id)}
                      >
                        <T k="pages.brief" />
                      </Button>
                    )}
                    {(!ops || hasClientService(ops, "vat")) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setVatWorkspaceClientId(client.id)}
                      >
                        VAT
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpenBooks(client.id)}
                      disabled={switchMutation.isPending}
                      data-testid={`button-open-books-${client.id}`}
                    >
                      <BookOpen className="w-3.5 h-3.5 me-1.5" />
                      <T k="pages.openBooks" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewProfile(client.id)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Table view */}
      {view === "table" && filtered.length > 0 && (
        <div className="border rounded-lg overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <T k="pages.client" />
                </TableHead>
                <TableHead>
                  <T k="pages.services" />
                </TableHead>
                <TableHead>TRN</TableHead>
                <TableHead>
                  <T k="pages.outstandingAr" />
                </TableHead>
                <TableHead>
                  <T k="pages.invoices" />
                </TableHead>
                <TableHead>
                  <T k="pages.vatStatus" />
                </TableHead>
                <TableHead>
                  <T k="pages.close" />
                </TableHead>
                <TableHead>
                  <T k="pages.owner" />
                </TableHead>
                <TableHead data-numeric>
                  <T k="pages.actions" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => {
                const ops = bookkeeperByClientId.get(client.id);
                return (
                  <TableRow key={client.id} className="hover:bg-muted/50">
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{client.name}</p>
                          {ops && <PriorityBadge priority={ops.priority} />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {ops?.nextBestAction ??
                            client.industry ??
                            t["clientPortfolio.openProfileForDetails"]}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ServiceScopeBadges
                        services={ops?.serviceScope ?? client.serviceScope}
                        compact
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {client.trnVatNumber || "—"}
                    </TableCell>
                    <TableCell className="font-medium">{formatAed(client.outstandingAr)}</TableCell>
                    <TableCell>{client.invoiceCount}</TableCell>
                    <TableCell>
                      {ops && hasClientService(ops, "vat") ? (
                        <div className="space-y-1">
                          <PriorityBadge priority={ops.vat.status} />
                          <p className="text-xs text-muted-foreground">{fx(ops.vat.cohortLabel)}</p>
                        </div>
                      ) : (
                        <Badge variant="outline">
                          <T k="pages.notScoped" />
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ops && hasClientService(ops, "bookkeeping")
                        ? `${ops.bookkeeping.closeProgress}% close`
                        : !ops && client.lastReceiptDate
                          ? format(new Date(client.lastReceiptDate), "MMM d, yyyy")
                          : t["pages.notScoped"]}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm">
                          {ops
                            ? ownerPreview(ops.assignedStaff.map((staff) => staff.name))
                            : client.assignedStaff.length}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell data-numeric>
                      <div className="flex justify-end gap-1">
                        {ops && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setBriefClientId(client.id)}
                          >
                            <T k="pages.brief" />
                          </Button>
                        )}
                        {(!ops || hasClientService(ops, "vat")) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setVatWorkspaceClientId(client.id)}
                          >
                            VAT
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleOpenBooks(client.id)}
                          disabled={switchMutation.isPending}
                        >
                          <BookOpen className="w-3.5 h-3.5 me-1" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewProfile(client.id)}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Client Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <T k="pages.addNewClient" />
            </DialogTitle>
            <DialogDescription>{t["clientPortfolio.createANewClientCompany"]}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t["clientPortfolio.alMajidTradingLlc"]}
              />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
              <div>
                <Label>
                  <T k="pages.nrServicesForThisClient" />
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {t["clientPortfolio.chooseOnlyTheServicesNra"]}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CLIENT_SERVICE_OPTIONS.map((option) => (
                  <label
                    key={option.code}
                    className="flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={form.serviceScope.includes(option.code)}
                      onCheckedChange={(checked) => {
                        setForm((current) => {
                          const serviceScope = checked
                            ? Array.from(new Set([...current.serviceScope, option.code]))
                            : current.serviceScope.filter((service) => service !== option.code);
                          return {
                            ...current,
                            serviceScope:
                              serviceScope.length > 0 ? serviceScope : current.serviceScope,
                          };
                        });
                      }}
                    />
                    <span>
                      <span className="font-medium block">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="trn">TRN / VAT Number</Label>
                <Input
                  id="trn"
                  value={form.trnVatNumber}
                  onChange={(e) => setForm((f) => ({ ...f, trnVatNumber: e.target.value }))}
                  placeholder="100234567890003"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="emirate">
                  <T k="pages.emirate" />
                </Label>
                <Select
                  value={form.emirate}
                  onValueChange={(v) => setForm((f) => ({ ...f, emirate: v }))}
                >
                  <SelectTrigger id="emirate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abu_dhabi">
                      <T k="pages.abuDhabi" />
                    </SelectItem>
                    <SelectItem value="dubai">
                      <T k="pages.dubai" />
                    </SelectItem>
                    <SelectItem value="sharjah">
                      <T k="pages.sharjah" />
                    </SelectItem>
                    <SelectItem value="ajman">
                      <T k="pages.ajman" />
                    </SelectItem>
                    <SelectItem value="umm_al_quwain">
                      <T k="pages.ummAlQuwain" />
                    </SelectItem>
                    <SelectItem value="ras_al_khaimah">
                      <T k="pages.rasAlKhaimah" />
                    </SelectItem>
                    <SelectItem value="fujairah">
                      <T k="pages.fujairah" />
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="legalStructure">
                  <T k="pages.legalStructure" />
                </Label>
                <Select
                  value={form.legalStructure}
                  onValueChange={(v) => setForm((f) => ({ ...f, legalStructure: v }))}
                >
                  <SelectTrigger id="legalStructure">
                    <SelectValue placeholder={t["clientPortfolio.select"]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">LLC</SelectItem>
                    <SelectItem value="Sole Proprietorship">
                      <T k="pages.soleProprietorship" />
                    </SelectItem>
                    <SelectItem value="Partnership">
                      <T k="pages.partnership" />
                    </SelectItem>
                    <SelectItem value="Corporation">
                      <T k="pages.corporation" />
                    </SelectItem>
                    <SelectItem value="Free Zone">
                      <T k="pages.freeZone" />
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="vatFrequency">
                  <T k="pages.vatFrequency" />
                </Label>
                <Select
                  value={form.vatFilingFrequency}
                  onValueChange={(v) => setForm((f) => ({ ...f, vatFilingFrequency: v }))}
                >
                  <SelectTrigger id="vatFrequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">
                      <T k="pages.monthly" />
                    </SelectItem>
                    <SelectItem value="quarterly">
                      <T k="pages.quarterly" />
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="vatCloseGroup">
                  <T k="pages.vatCloseGroup" />
                </Label>
                <Select
                  value={form.vatPeriodStartMonth}
                  onValueChange={(v) => setForm((f) => ({ ...f, vatPeriodStartMonth: v }))}
                >
                  <SelectTrigger id="vatCloseGroup">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      <T k="pages.autoFromNrClientGroup" />
                    </SelectItem>
                    <SelectItem value="11">Jan / Apr / Jul / Oct</SelectItem>
                    <SelectItem value="12">Feb / May / Aug / Nov</SelectItem>
                    <SelectItem value="1">Mar / Jun / Sep / Dec</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fiscalYearStart">
                  <T k="pages.financialYearStart" />
                </Label>
                <Select
                  value={form.fiscalYearStartMonth}
                  onValueChange={(v) => setForm((f) => ({ ...f, fiscalYearStartMonth: v }))}
                >
                  <SelectTrigger id="fiscalYearStart">
                    <SelectValue />
                  </SelectTrigger>
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
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="industry">
                <T k="pages.industry" />
              </Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                placeholder={t["clientPortfolio.tradingConstructionRetail"]}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="corporateTaxId">
                <T k="pages.corporateTaxRegistration" />
              </Label>
              <Input
                id="corporateTaxId"
                value={form.corporateTaxId}
                onChange={(e) => setForm((f) => ({ ...f, corporateTaxId: e.target.value }))}
                placeholder="CT-1002345678"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="contactEmail">
                  <T k="pages.email" />
                </Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="info@company.ae"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contactPhone">
                  <T k="pages.phone" />
                </Label>
                <Input
                  id="contactPhone"
                  value={form.contactPhone}
                  onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+971 4 123 4567"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="businessAddress">
                <T k="pages.businessAddress" />
              </Label>
              <Input
                id="businessAddress"
                value={form.businessAddress}
                onChange={(e) => setForm((f) => ({ ...f, businessAddress: e.target.value }))}
                placeholder={t["clientPortfolio.office301BusinessBayDubai"]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-create-client"
            >
              {createMutation.isPending ? "Creating..." : t["clientPortfolio.createClient"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Clients Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <T k="pages.importClients" />
            </DialogTitle>
            <DialogDescription>
              Upload a CSV or Excel file. Each row becomes a new client company with a UAE chart of
              accounts. Recognised columns: name, TRN, email, phone, industry, address, emirate, VAT
              filing, VAT close group, financial year start, corporate tax ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">CSV / XLSX file</Label>
              <FileDrop
                id="import-file"
                accept=".csv,.xlsx,.xls"
                value={importFile?.name}
                onFiles={([f]) => {
                  setImportFile(f ?? null);
                  setImportResult(null);
                }}
                onClear={() => setImportFile(null)}
              />
              <p className="text-xs text-muted-foreground">Up to 500 rows per upload.</p>
            </div>
            {importResult && (
              <div className="rounded border p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">
                    <T k="pages.imported" />
                  </span>
                  <span className="text-success">{importResult.created.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">
                    <T k="pages.errors" />
                  </span>
                  <span className={importResult.errors.length > 0 ? "text-destructive" : ""}>
                    {importResult.errors.length}
                  </span>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-40 overflow-auto text-xs text-muted-foreground space-y-1">
                    {importResult.errors.slice(0, 20).map((e, i) => (
                      <div key={i}>
                        Row {e.row}
                        {e.name ? ` (${e.name})` : ""}: {e.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              <T k="pages.close" />
            </Button>
            <Button
              onClick={() => importFile && importMutation.mutate(importFile)}
              disabled={!importFile || importMutation.isPending}
              data-testid="button-import-clients"
            >
              <Upload className="w-4 h-4 me-2" />
              {importMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OperationsBriefDialog
        client={briefClient}
        open={!!briefClientId}
        onOpenChange={(open) => !open && setBriefClientId(null)}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
      />
      <VatWorkspaceDialog
        client={vatWorkspaceClient}
        ops={vatWorkspaceOps}
        open={!!vatWorkspaceClientId}
        onOpenChange={(open) => !open && setVatWorkspaceClientId(null)}
      />
    </div>
  );
}
