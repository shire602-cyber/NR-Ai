import { formatAedText } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { T } from "@/components/layout/T";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, useSearch } from "wouter";
import {
  FileText,
  Users,
  Edit,
  Save,
  X,
  BookOpen,
  ExternalLink,
  Shield,
  AlertCircle,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ServiceScopeBadges } from "./portfolio/badges";
import { ClientDocumentsTab } from "./client-profile/ClientDocumentsTab";
import { ClientTasksTab } from "./client-profile/ClientTasksTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format-date";
import { monthLabel, monthOptions, vatCloseGroupLabel, vatCloseGroups } from "@/lib/month-labels";
import { statusLabel } from "@/lib/status-label";
import type { Company } from "@shared/schema";
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  type ClientServiceCode,
  type ClientServicePlan,
} from "@shared/client-services";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { classifyLoadError } from "@/lib/loadError";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";

interface AssignedStaff {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ClientStats {
  invoiceCount: number;
  invoiceTotal: number;
  outstandingAr: number;
  lastReceiptDate: string | null;
  lastBankActivityDate: string | null;
  vatStatus: {
    status: string;
    dueDate: string;
    periodEnd: string;
  } | null;
  assignedStaff: AssignedStaff[];
}

interface ClientSummary {
  company: Company & { serviceScope?: ClientServiceCode[]; servicePlan?: ClientServicePlan };
  stats: ClientStats;
  companyUsers: { id: string; role: string; user: { id: string; name: string; email: string } }[];
  recentInvoices: any[];
  recentReceipts: any[];
  servicePlan?: ClientServicePlan;
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  assignedClients: { companyId: string; companyName: string; role: string }[];
}

type ClientEditData = Partial<Company> & { serviceScope?: ClientServiceCode[] };

function formatAed(amount: number) {
  return formatAedText(amount);
}

function activeServiceScope(
  company: { serviceScope?: ClientServiceCode[] },
  editData: ClientEditData
): ClientServiceCode[] {
  return editData.serviceScope ?? company.serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES;
}

/** Emirate id (`abu_dhabi`) as its label; a free-text value is shown as typed. */
function emirateLabel(t: Record<string, string>, value: string): string {
  return t[`invoices.emirate.${value}`] ?? value.replace(/_/g, " ");
}

function EditableField({
  label,
  value,
  editing,
  onChange,
  type = "text",
  placeholder,
  display,
}: {
  label: string;
  value: string | null | undefined;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** Read-only text when it differs from the stored value (an id shown as its label). */
  display?: string | null;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {editing ? (
        <Input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || label}
          className="h-8"
        />
      ) : (
        <p className="text-sm font-medium">{display ?? (value || "—")}</p>
      )}
    </div>
  );
}

export default function ClientProfile() {
  const { t, locale } = useTranslation();
  const { companyId } = useParams<{ companyId: string }>();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const tab = tabParam === "documents" || tabParam === "tasks" ? tabParam : "overview";
  const selectTab = (next: string) =>
    navigate(`${location.split("?")[0]}${next === "overview" ? "" : `?tab=${next}`}`, {
      replace: true,
    });
  const { toast } = useToast();
  const { setActiveClientCompany } = useActiveCompany();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<ClientEditData>({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState("");

  const switchMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/firm/clients/${companyId}/switch`),
    onSuccess: async () => {
      // Commit the switch (cache reset) before navigating: the shell must see the client first.
      if (companyId) await setActiveClientCompany(companyId);
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

  const {
    data: summary,
    isLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<ClientSummary>({
    // The default retry policy skips 4xx, so a 403/404 is requested once.
    queryKey: [`/api/firm/clients/${companyId}/summary`],
    enabled: !!companyId,
  });

  const { data: firmStaff = [] } = useQuery<StaffMember[]>({
    queryKey: ["/api/firm/staff"],
    enabled: assignOpen,
  });

  const updateMutation = useMutation({
    mutationFn: (data: ClientEditData) => apiRequest("PUT", `/api/firm/clients/${companyId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/firm/clients/${companyId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      toast({ title: t["clientProfile.clientUpdatedSuccessfully"] });
      setEditing(false);
      setEditData({});
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.updateFailed2"),
        description: e?.message,
      });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ staffUserId, action }: { staffUserId: string; action: "assign" | "unassign" }) =>
      apiRequest("POST", `/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId,
        action,
        role: "accountant",
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/firm/clients/${companyId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/bookkeeper-dashboard"] });
      toast({
        title:
          vars.action === "assign"
            ? t["clientProfile.staffAssigned"]
            : t["clientProfile.staffUnassigned"],
      });
      setAssignOpen(false);
      setSelectedStaff("");
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.assignmentFailed"),
        description: e?.message,
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <T k="pages.loadingClientProfile" />
      </div>
    );
  }

  if (!summary) {
    // Each cause has its own translated copy: a server failure is never reported as "not found",
    // and the server's own message (or the browser's "Failed to fetch") is never shown.
    const kind = classifyLoadError(summaryError);
    const backToPortfolio = (
      <Button variant="ghost" onClick={() => navigate("/firm/clients")}>
        <T k="pages.backToPortfolio" />
      </Button>
    );
    if (kind === "server" || kind === "offline") {
      return (
        <div className="space-y-3">
          <LoadErrorState error={summaryError} onRetry={() => void refetchSummary()} />
          <div className="flex justify-center">{backToPortfolio}</div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" aria-hidden />
        <h1 className="font-medium">
          {kind === "forbidden" ? t["clientProfile.accessDenied"] : t["clientProfile.notFound"]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          {kind === "forbidden"
            ? t["clientProfile.accessDeniedHelp"]
            : t["clientProfile.linkOutdated"]}
        </p>
        {backToPortfolio}
      </div>
    );
  }

  const { company, stats } = summary;
  const current = { ...company, ...editData };
  const serviceScope = activeServiceScope(company, editData);

  const handleEdit = () => {
    setEditData({});
    setEditing(true);
  };

  const handleSave = () => {
    if (Object.keys(editData).length === 0) {
      setEditing(false);
      return;
    }
    updateMutation.mutate(editData);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditData({});
  };

  const field = (key: keyof Company) => ({
    value: current[key] as string | null | undefined,
    editing,
    onChange: (v: string) => setEditData((d) => ({ ...d, [key]: v })),
  });

  const assignedIds = new Set(stats.assignedStaff.map((s) => s.id));
  const unassignedStaff = firmStaff.filter((s) => !assignedIds.has(s.id));

  return (
    <div className="space-y-6">
      {/* Fable P18 / spec G5: the standard PageHeader (back link, eyebrow, title, description,
          actions); no icon tile beside the title. */}
      <PageHeader
        backHref="/firm/clients"
        backLabel={t["pages.nraClientPortfolio"]}
        eyebrow="Firm"
        title={company.name}
        description={
          <>
            {company.trnVatNumber
              ? formatMessage(t["firmOps.healthTrn"], { trn: company.trnVatNumber })
              : t["clientProfile.noTrnRegistered"]}
            {company.emirate ? ` · ${emirateLabel(t, company.emirate)}` : ""}
          </>
        }
        actions={
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" onClick={handleCancel}>
                  <X className="w-4 h-4 me-1" />
                  <T k="pages.cancel" />
                </Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 me-1" />
                  {updateMutation.isPending ? "Saving..." : t["pages.saveChanges"]}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={handleEdit}>
                  <Edit className="w-4 h-4 me-1" />
                  {t["firmOps.edit"]}
                </Button>
                <Button
                  onClick={() => switchMutation.mutate()}
                  disabled={switchMutation.isPending}
                  data-testid="button-open-books-profile"
                >
                  <BookOpen className="w-4 h-4 me-2" />
                  {switchMutation.isPending ? "Switching..." : t["pages.openBooks"]}
                  <ExternalLink className="w-3.5 h-3.5 ms-1.5" />
                </Button>
              </>
            )}
          </div>
        }
      />

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList aria-label={t["firmOps.clientTabOverview"]}>
          <TabsTrigger value="overview" data-testid="client-tab-overview-trigger">
            {t["firmOps.clientTabOverview"]}
          </TabsTrigger>
          <TabsTrigger value="documents" data-testid="client-tab-documents-trigger">
            {t["firmOps.clientTabDocuments"]}
          </TabsTrigger>
          <TabsTrigger value="tasks" data-testid="client-tab-tasks-trigger">
            {t["firmOps.clientTabTasks"]}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.outstandingAr" />
                </p>
                <p className="text-xl font-bold mt-0.5">{formatAed(stats.outstandingAr)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.totalInvoices" />
                </p>
                <p className="text-xl font-bold mt-0.5">{stats.invoiceCount}</p>
                <p className="text-xs text-muted-foreground">{formatAed(stats.invoiceTotal)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.lastReceipt2" />
                </p>
                <p className="text-sm font-semibold mt-0.5">
                  {stats.lastReceiptDate
                    ? formatDate(stats.lastReceiptDate, locale)
                    : t["banking.feeds.never"]}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.vatStatus" />
                </p>
                {stats.vatStatus ? (
                  <div className="mt-0.5">
                    <Badge
                      className={
                        stats.vatStatus.status === "filed"
                          ? "bg-success-subtle text-success-subtle-foreground border-success/30"
                          : "bg-warning-subtle text-warning-subtle-foreground border-warning/30"
                      }
                    >
                      {statusLabel(t, stats.vatStatus.status)}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatMessage(t["firmOps.chaseDue"], {
                        date: formatDate(stats.vatStatus.dueDate, locale),
                      })}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    <T k="pages.noReturns" />
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <T k="pages.nrServiceScope" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {CLIENT_SERVICE_OPTIONS.map((option) => (
                    <label
                      key={option.code}
                      className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={serviceScope.includes(option.code)}
                        onCheckedChange={(checked) => {
                          setEditData((data) => {
                            const existing =
                              data.serviceScope ??
                              company.serviceScope ??
                              DEFAULT_CLIENT_SERVICE_CODES;
                            const next = checked
                              ? Array.from(new Set([...existing, option.code]))
                              : existing.filter((service) => service !== option.code);
                            return {
                              ...data,
                              serviceScope: next.length > 0 ? next : existing,
                            };
                          });
                        }}
                      />
                      <span>
                        <span className="font-medium block">
                          {t[`firmOps.service_${option.code}_label`]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t[`firmOps.service_${option.code}_desc`]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <ServiceScopeBadges services={serviceScope} compact />
                  <p className="text-xs text-muted-foreground">
                    {t["clientProfile.vatCorporateTaxBookkeepingAnd"]}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Company Info */}
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  <T k="pages.companyInformation" />
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <EditableField label={t["pages.companyName"]} {...field("name")} />
                <EditableField label={t["clientProfile.trnVatNumber"]} {...field("trnVatNumber")} />
                <EditableField label={t["pages.legalStructure"]} {...field("legalStructure")} />
                <EditableField label={t["pages.industry"]} {...field("industry")} />
                <EditableField
                  label={t["clientProfile.registrationNumber"]}
                  {...field("registrationNumber")}
                />
                <EditableField
                  label={t["components.vwColEmirate"]}
                  {...field("emirate")}
                  display={
                    company.emirate ? emirateLabel(t, current.emirate ?? company.emirate) : null
                  }
                />
                <div className="col-span-2">
                  <EditableField
                    label={t["pages.businessAddress"]}
                    {...field("businessAddress")}
                    placeholder={t["clientProfile.streetAreaCity"]}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Contact & Tax */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    <T k="pages.contact" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <EditableField
                    label={t["forms.contact.email"]}
                    {...field("contactEmail")}
                    type="email"
                  />
                  <EditableField label={t["pages.phone"]} {...field("contactPhone")} type="tel" />
                  <EditableField label={t["pages.website"]} {...field("websiteUrl")} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    <T k="pages.taxCompliance" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-1">
                    <p className="text-xs text-muted-foreground">
                      <T k="pages.vatFiling" />
                    </p>
                    {editing ? (
                      <Select
                        value={current.vatFilingFrequency || "quarterly"}
                        onValueChange={(v) => setEditData((d) => ({ ...d, vatFilingFrequency: v }))}
                      >
                        <SelectTrigger className="h-8">
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
                    ) : (
                      <p className="text-sm font-medium">
                        {company.vatFilingFrequency === "monthly"
                          ? t["pages.monthly"]
                          : t["pages.quarterly"]}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-1">
                    <p className="text-xs text-muted-foreground">
                      <T k="pages.vatCloseGroup" />
                    </p>
                    {editing ? (
                      <Select
                        value={String(current.vatPeriodStartMonth || 1)}
                        onValueChange={(v) =>
                          setEditData((d) => ({ ...d, vatPeriodStartMonth: Number(v) }))
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {vatCloseGroups(locale).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm font-medium">
                        {vatCloseGroupLabel(company.vatPeriodStartMonth, locale)}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-1">
                    <p className="text-xs text-muted-foreground">
                      <T k="pages.financialYearStart" />
                    </p>
                    {editing ? (
                      <Select
                        value={String(current.fiscalYearStartMonth || 1)}
                        onValueChange={(v) =>
                          setEditData((d) => ({ ...d, fiscalYearStartMonth: Number(v) }))
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {monthOptions(locale).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm font-medium">
                        {monthLabel(company.fiscalYearStartMonth, locale)}
                      </p>
                    )}
                  </div>
                  <EditableField
                    label={t["pages.taxRegistrationType"]}
                    {...field("taxRegistrationType")}
                  />
                  <EditableField
                    label={t["pages.corporateTaxRegistration"]}
                    {...field("corporateTaxId")}
                  />
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Assigned Staff */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                <T k="pages.assignedNraStaff" />
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                <UserPlus className="w-4 h-4 me-1.5" />
                <T k="pages.assignStaff" />
              </Button>
            </CardHeader>
            <CardContent>
              {stats.assignedStaff.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">
                    <T k="pages.noStaffAssignedToThisClientYet" />
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.assignedStaff.map((staff) => (
                    <div
                      key={staff.id}
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{staff.name}</p>
                          <p className="text-xs text-muted-foreground">{staff.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{statusLabel(t, staff.role)}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            assignMutation.mutate({ staffUserId: staff.id, action: "unassign" })
                          }
                          disabled={assignMutation.isPending}
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          {summary.recentInvoices.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  <T k="pages.recentInvoices" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {summary.recentInvoices.slice(0, 5).map((inv: any) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{inv.number}</p>
                          <p className="text-xs text-muted-foreground">{inv.customerName}</p>
                        </div>
                      </div>
                      <div className="text-end">
                        <p className="text-sm font-medium">{formatAed(inv.total)}</p>
                        <Badge
                          variant={inv.status === "paid" ? "outline" : "secondary"}
                          className="text-xs"
                        >
                          {statusLabel(t, inv.status)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="documents" className="mt-6">
          {tab === "documents" && companyId ? <ClientDocumentsTab companyId={companyId} /> : null}
        </TabsContent>
        <TabsContent value="tasks" className="mt-6">
          {tab === "tasks" && companyId ? <ClientTasksTab companyId={companyId} /> : null}
        </TabsContent>
      </Tabs>

      {/* Assign Staff Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {formatMessage(t["firmOps.assignStaffTitle"], { name: company.name })}
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-3">
            {unassignedStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                <T k="pages.allFirmStaffAreAlreadyAssignedToThisClient" />
              </p>
            ) : (
              <>
                <Label>
                  <T k="pages.selectStaffMember" />
                </Label>
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder={t["clientProfile.chooseAStaffMember"]} />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAssignOpen(false);
                setSelectedStaff("");
              }}
            >
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={() =>
                assignMutation.mutate({ staffUserId: selectedStaff, action: "assign" })
              }
              disabled={!selectedStaff || assignMutation.isPending}
            >
              {assignMutation.isPending ? t["firmOps.assigning"] : t["firmOps.assign"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
