import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  FileText,
  Receipt,
  Users,
  Calendar,
  Edit,
  Save,
  X,
  BookOpen,
  ExternalLink,
  Shield,
  CheckCircle2,
  AlertCircle,
  Clock,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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
import { format } from "date-fns";
import type { Company } from "@shared/schema";
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  serviceLabels,
  type ClientServiceCode,
  type ClientServicePlan,
} from "@shared/client-services";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { PortalAccessCard } from "./PortalAccessCard";
import { messages as pageMessages } from "./ClientProfile.i18n";

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
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const getMonthOptions = () => [
  { value: "1", label: pageMessages.t("january") },
  { value: "2", label: pageMessages.t("february") },
  { value: "3", label: pageMessages.t("march") },
  { value: "4", label: pageMessages.t("april") },
  { value: "5", label: pageMessages.t("may") },
  { value: "6", label: pageMessages.t("june") },
  { value: "7", label: pageMessages.t("july") },
  { value: "8", label: pageMessages.t("august") },
  { value: "9", label: pageMessages.t("september") },
  { value: "10", label: pageMessages.t("october") },
  { value: "11", label: pageMessages.t("november") },
  { value: "12", label: pageMessages.t("december") },
];

const getVatCloseGroups = () => [
  { value: "11", label: pageMessages.t("janAprJulOct") },
  { value: "12", label: pageMessages.t("febMayAugNov") },
  { value: "1", label: pageMessages.t("marJunSepDec") },
];

function monthLabel(month: number | string | null | undefined) {
  return (
    getMonthOptions().find((option) => option.value === String(month || 1))?.label ??
    pageMessages.t("january")
  );
}

function vatCloseGroupLabel(periodStartMonth: number | string | null | undefined) {
  return (
    getVatCloseGroups().find((option) => option.value === String(periodStartMonth || 1))?.label ??
    pageMessages.t("marJunSepDec")
  );
}

function activeServiceScope(
  company: { serviceScope?: ClientServiceCode[] },
  editData: ClientEditData
): ClientServiceCode[] {
  return editData.serviceScope ?? company.serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES;
}

function ServiceBadges({ services }: { services: readonly ClientServiceCode[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {serviceLabels(services).map((label) => (
        <Badge key={label} variant="outline" className="text-[11px]">
          {label}
        </Badge>
      ))}
    </div>
  );
}

function EditableField({
  label,
  value,
  editing,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      {editing ? (
        <Input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || label}
          className="h-8"
        />
      ) : (
        <p className="text-sm font-medium">{value || "—"}</p>
      )}
    </div>
  );
}

export default function ClientProfile() {
  const tr = pageMessages.useT();

  const { companyId } = useParams<{ companyId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { setActiveClientCompany } = useActiveCompany();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<ClientEditData>({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState("");

  const switchMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/firm/clients/${companyId}/switch`),
    onSuccess: () => {
      if (companyId) setActiveClientCompany(companyId);
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      navigate("/dashboard");
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: tr("couldNotOpenClientBooks"),
        description: e?.message,
      });
    },
  });

  const {
    data: summary,
    isLoading,
    error: summaryError,
  } = useQuery<ClientSummary>({
    queryKey: [`/api/firm/clients/${companyId}/summary`],
    enabled: !!companyId,
    retry: 1,
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
      toast({ title: tr("clientUpdatedSuccessfully") });
      setEditing(false);
      setEditData({});
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: tr("updateFailed"), description: e?.message });
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
      toast({ title: vars.action === "assign" ? tr("staffAssigned") : tr("staffUnassigned") });
      setAssignOpen(false);
      setSelectedStaff("");
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: tr("assignmentFailed"), description: e?.message });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {tr("loadingClientProfile")}
      </div>
    );
  }

  if (!summary) {
    // Surface the server's actual reason — access denied, not-a-client, and
    // genuinely-missing are different problems with different fixes.
    const message = (summaryError as any)?.message || tr("clientNotFound");
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="font-medium">{message}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          {message.toLowerCase().includes("access")
            ? tr("yourAccountDoesNotHaveThis")
            : message.toLowerCase().includes("not an nra client")
              ? tr("thisCompanyExistsButIsNot")
              : tr("theLinkMayBeOutdatedOr")}
        </p>
        <Button variant="ghost" onClick={() => navigate("/firm/clients")}>
          {tr("backToPortfolio")}
        </Button>
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
    <div className="space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/firm/clients")}>
          <ArrowLeft className="w-4 h-4 me-1" />
          {tr("nraClientPortfolio")}
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">{company.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {company.trnVatNumber
                ? tr("trn", { trnVatNumber: company.trnVatNumber })
                : tr("noTrnRegistered")}
              {company.emirate ? ` · ${company.emirate.replace(/_/g, " ")}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={handleCancel}>
                <X className="w-4 h-4 me-1" />
                {tr("cancel")}
              </Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                <Save className="w-4 h-4 me-1" />
                {updateMutation.isPending ? tr("saving") : tr("saveChanges")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleEdit}>
                <Edit className="w-4 h-4 me-1" />
                {tr("edit")}
              </Button>
              <Button
                onClick={() => switchMutation.mutate()}
                disabled={switchMutation.isPending}
                data-testid="button-open-books-profile"
              >
                <BookOpen className="w-4 h-4 me-2" />
                {switchMutation.isPending ? tr("switching") : tr("openBooks")}
                <ExternalLink className="w-3.5 h-3.5 ms-1.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{tr("outstandingAr")}</p>
            <p className="text-xl font-bold mt-0.5">{formatAed(stats.outstandingAr)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{tr("totalInvoices")}</p>
            <p className="text-xl font-bold mt-0.5">{stats.invoiceCount}</p>
            <p className="text-xs text-muted-foreground">{formatAed(stats.invoiceTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{tr("lastReceipt")}</p>
            <p className="text-sm font-semibold mt-0.5">
              {stats.lastReceiptDate
                ? format(new Date(stats.lastReceiptDate), "MMM d, yyyy")
                : tr("never")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">{tr("vatStatus")}</p>
            {stats.vatStatus ? (
              <div className="mt-0.5">
                <Badge
                  className={
                    stats.vatStatus.status === "filed"
                      ? "bg-success-subtle text-success-subtle-foreground border-success/30"
                      : "bg-warning-subtle text-warning-subtle-foreground border-warning/30"
                  }
                >
                  {stats.vatStatus.status.replace(/_/g, " ")}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  {tr("due", { format: format(new Date(stats.vatStatus.dueDate), "MMM d, yyyy") })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">{tr("noReturns")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            {tr("nrServiceScope")}
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
                          data.serviceScope ?? company.serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES;
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
                    <span className="font-medium block">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <ServiceBadges services={serviceScope} />
              <p className="text-xs text-muted-foreground">
                {tr("vatCorporateTaxBookkeepingAndAccounting")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Company Info */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tr("companyInformation")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <EditableField label={tr("companyName")} {...field("name")} />
            <EditableField label={tr("trnVatNumber")} {...field("trnVatNumber")} />
            <EditableField label={tr("legalStructure")} {...field("legalStructure")} />
            <EditableField label={tr("industry")} {...field("industry")} />
            <EditableField label={tr("registrationNumber")} {...field("registrationNumber")} />
            <EditableField label={tr("emirate")} {...field("emirate")} />
            <div className="col-span-2">
              <EditableField
                label={tr("businessAddress")}
                {...field("businessAddress")}
                placeholder={tr("streetAreaCity")}
              />
            </div>
          </CardContent>
        </Card>

        {/* Contact & Tax */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tr("contact")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <EditableField label={tr("email")} {...field("contactEmail")} type="email" />
              <EditableField label={tr("phone")} {...field("contactPhone")} type="tel" />
              <EditableField label={tr("website")} {...field("websiteUrl")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tr("taxCompliance")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {tr("vatFiling")}
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
                      <SelectItem value="monthly">{tr("monthly")}</SelectItem>
                      <SelectItem value="quarterly">{tr("quarterly")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium capitalize">
                    {company.vatFilingFrequency || tr("quarterly2")}
                  </p>
                )}
              </div>
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {tr("vatCloseGroup")}
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
                      {getVatCloseGroups().map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium">
                    {vatCloseGroupLabel(company.vatPeriodStartMonth)}
                  </p>
                )}
              </div>
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {tr("financialYearStart")}
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
                      {getMonthOptions().map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium">{monthLabel(company.fiscalYearStartMonth)}</p>
                )}
              </div>
              <EditableField label={tr("taxRegistrationType")} {...field("taxRegistrationType")} />
              <EditableField label={tr("corporateTaxRegistration")} {...field("corporateTaxId")} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Assigned Staff */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">{tr("assignedNraStaff")}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
            <UserPlus className="w-4 h-4 me-1.5" />
            {tr("assignStaff")}
          </Button>
        </CardHeader>
        <CardContent>
          {stats.assignedStaff.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{tr("noStaffAssignedToThisClient")}</p>
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
                    <Badge variant="outline" className="capitalize">
                      {staff.role}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
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

      {/* Client portal invites + portal users */}
      {companyId && <PortalAccessCard companyId={companyId} />}

      {/* Recent Activity */}
      {summary.recentInvoices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tr("recentInvoices")}</CardTitle>
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
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assign Staff Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("assignStaffTo", { name: company.name })}</DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-3">
            {unassignedStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {tr("allFirmStaffAreAlreadyAssigned")}
              </p>
            ) : (
              <>
                <Label>{tr("selectStaffMember")}</Label>
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder={tr("chooseAStaffMember")} />
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
              {tr("cancel")}
            </Button>
            <Button
              onClick={() =>
                assignMutation.mutate({ staffUserId: selectedStaff, action: "assign" })
              }
              disabled={!selectedStaff || assignMutation.isPending}
            >
              {assignMutation.isPending ? tr("assigning") : tr("assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
