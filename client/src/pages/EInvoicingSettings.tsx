import { TrialBanner } from "@/components/TrialBanner";
import { useMemo, useState } from "react";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { DatePicker } from "@/components/ui/date-picker";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileCheck2, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { EInvoiceProviderCard } from "@/components/einvoice/EInvoiceProviderCard";
import { EInvoicePartnerCard } from "@/components/einvoice/EInvoicePartnerCard";
import "@/components/einvoice/einvoice-theme.css";

// UAE e-invoicing (PINT AE) settings: identity, scope, ASP status, per-invoice
// validation, archive and inbound documents (W4-C, R07-04/R07-13/R03-18/R04-23).
// Copy lives here in both locales; nothing claims a connection that does not exist.

const COPY = {
  en: {
    eyebrow: "Settings",
    title: "UAE e-invoicing",
    description:
      "Peppol PINT AE documents for the FTA e-invoicing system. Transmission runs through an Accredited Service Provider (ASP).",
    scopeTitle: "Scope and go-live",
    scope: "Scope",
    scopeB2b: "B2B",
    scopeB2g: "B2G",
    scopeBoth: "B2B and B2G",
    scopeNone: "Not in scope",
    band: "Turnover band",
    bandLarge: "Revenue AED 50m or more (go-live 1 Jan 2027)",
    bandStandard: "Revenue below AED 50m (go-live 1 Jul 2027)",
    bandGovernment: "Government entity (go-live 1 Oct 2027)",
    goLiveOverride: "Go-live date override",
    goLive: "Go-live",
    appointBy: "Appoint an ASP by",
    daysLeft: "Days to go-live",
    mandatory: "Mandatory now",
    notMandatory: "Not yet mandatory",
    identityTitle: "Peppol identity",
    participantId: "Peppol participant ID",
    participantHint: "Defaults to your TIN (first 10 digits of the TRN):",
    scheme: "Scheme (ISO 6523)",
    tradeLicence: "Trade licence number",
    tradeLicenceAuthority: "Issuing authority",
    iban: "Payee IBAN",
    paymentMeans: "Payment means",
    pmUndefined: "Not specified",
    pmCash: "Cash",
    pmTransfer: "Credit transfer",
    pmBank: "Payment to bank account",
    pmCard: "Bank card",
    pmDebit: "Direct debit",
    save: "Save",
    saved: "E-invoicing settings saved",
    saveFailed: "Could not save settings",
    downloadFailed: "The file could not be downloaded. Try again.",
    validationTitle: "Validation",
    xsd: "UBL 2.1 XSD",
    schematron: "PINT AE schematron",
    rules: "PINT AE rule list",
    available: "Available",
    unavailable: "Not available yet",
    documentsTitle: "Invoice e-documents",
    invoice: "Invoice",
    status: "Status",
    attempts: "Attempts",
    nextRetry: "Next retry",
    result: "Validation",
    valid: "Passed",
    invalid: "errors",
    none: "None yet",
    archiveTitle: "Archive (retained 5 years, immutable)",
    kind: "Kind",
    direction: "Direction",
    retainUntil: "Retain until",
    hash: "SHA-256",
    download: "Download",
    inboundTitle: "Received supplier e-invoices",
    inboundEnabled: "Receiving supplier e-invoices",
    inboundDisabled: "Receiving supplier e-invoices is not available yet",
    endpoint: "Endpoint",
    developerDetails: "Developer details",
    copy: "Copy",
    copied: "Copied",
    supplier: "Supplier",
    bill: "Draft bill",
    loading: "Loading…",
    loadFailed: "Could not load this list.",
    retry: "Retry",
    problemReported:
      "The provider reported a problem. Open the invoice's e-invoice status for details.",
    st_generated: "Generated",
    st_queued: "Queued",
    st_submitted: "Submitted",
    st_accepted: "Accepted",
    st_cleared: "Cleared",
    st_rejected: "Rejected",
    st_failed: "Failed",
    st_cancelled: "Withdrawn",
    st_pending: "Pending",
    st_received: "Received",
    st_bill_created: "Bill created",
    st_error: "Error",
    dir_outbound: "Sent",
    dir_inbound: "Received",
  },
  ar: {
    eyebrow: "الإعدادات",
    title: "الفوترة الإلكترونية في الإمارات",
    description:
      "مستندات Peppol PINT AE لنظام الفوترة الإلكترونية لدى الهيئة الاتحادية للضرائب. يتم الإرسال عبر مزود خدمة معتمد.",
    scopeTitle: "النطاق وموعد التطبيق",
    scope: "النطاق",
    scopeB2b: "بين الشركات",
    scopeB2g: "مع الجهات الحكومية",
    scopeBoth: "بين الشركات ومع الجهات الحكومية",
    scopeNone: "خارج النطاق",
    band: "شريحة الإيرادات",
    bandLarge: "إيرادات 50 مليون درهم أو أكثر (التطبيق 1 يناير 2027)",
    bandStandard: "إيرادات أقل من 50 مليون درهم (التطبيق 1 يوليو 2027)",
    bandGovernment: "جهة حكومية (التطبيق 1 أكتوبر 2027)",
    goLiveOverride: "تاريخ تطبيق مخصص",
    goLive: "موعد التطبيق",
    appointBy: "تعيين مزود الخدمة قبل",
    daysLeft: "الأيام المتبقية",
    mandatory: "إلزامي الآن",
    notMandatory: "غير إلزامي بعد",
    identityTitle: "هوية Peppol",
    participantId: "معرّف المشارك في Peppol",
    participantHint: "الافتراضي هو الرقم الضريبي (أول 10 أرقام من رقم التسجيل الضريبي):",
    scheme: "المخطط (ISO 6523)",
    tradeLicence: "رقم الرخصة التجارية",
    tradeLicenceAuthority: "جهة الإصدار",
    iban: "رقم الآيبان للمستفيد",
    paymentMeans: "وسيلة الدفع",
    pmUndefined: "غير محدد",
    pmCash: "نقداً",
    pmTransfer: "تحويل دائن",
    pmBank: "دفع إلى حساب بنكي",
    pmCard: "بطاقة بنكية",
    pmDebit: "خصم مباشر",
    save: "حفظ",
    saved: "تم حفظ إعدادات الفوترة الإلكترونية",
    saveFailed: "تعذّر حفظ الإعدادات",
    downloadFailed: "تعذّر تنزيل الملف. حاول مرة أخرى.",
    validationTitle: "التحقق",
    xsd: "مخطط UBL 2.1",
    schematron: "قواعد PINT AE الرسمية",
    rules: "قائمة قواعد PINT AE",
    available: "متاح",
    unavailable: "غير متاح بعد",
    documentsTitle: "المستندات الإلكترونية للفواتير",
    invoice: "الفاتورة",
    status: "الحالة",
    attempts: "المحاولات",
    nextRetry: "المحاولة التالية",
    result: "التحقق",
    valid: "ناجح",
    invalid: "أخطاء",
    none: "لا يوجد بعد",
    archiveTitle: "الأرشيف (يُحفظ 5 سنوات، غير قابل للتعديل)",
    kind: "النوع",
    direction: "الاتجاه",
    retainUntil: "يُحفظ حتى",
    hash: "بصمة SHA-256",
    download: "تنزيل",
    inboundTitle: "فواتير الموردين الإلكترونية المستلمة",
    inboundEnabled: "استقبال الفواتير مفعّل",
    inboundDisabled: "استقبال فواتير الموردين الإلكترونية غير متاح بعد",
    endpoint: "نقطة الاستقبال",
    developerDetails: "تفاصيل للمطورين",
    copy: "نسخ",
    copied: "تم النسخ",
    supplier: "المورد",
    bill: "فاتورة مورد مسودة",
    loading: "جارٍ التحميل…",
    loadFailed: "تعذّر تحميل هذه القائمة.",
    retry: "إعادة المحاولة",
    problemReported: "أبلغ المزود عن مشكلة. افتح حالة الفاتورة الإلكترونية لمعرفة التفاصيل.",
    st_generated: "تم الإنشاء",
    st_queued: "في قائمة الانتظار",
    st_submitted: "تم الإرسال",
    st_accepted: "مقبولة",
    st_cleared: "تم الاعتماد",
    st_rejected: "مرفوضة",
    st_failed: "فشلت",
    st_cancelled: "مسحوبة",
    st_pending: "قيد الانتظار",
    st_received: "مستلمة",
    st_bill_created: "تم إنشاء الفاتورة",
    st_error: "خطأ",
    dir_outbound: "مرسلة",
    dir_inbound: "مستلمة",
  },
} as const;

type Copy = Record<keyof (typeof COPY)["en"], string>;

/** A stored status/direction/kind word in the page language (unknown values show as stored). */
function word(s: Copy, prefix: "st" | "dir", value: string | null | undefined): string {
  if (!value) return "—";
  return (s as Record<string, string>)[`${prefix}_${value}`] ?? value;
}

interface Localized {
  en: string;
  ar: string;
}

interface SettingsView {
  identity: {
    trn: string | null;
    peppolParticipantId: string | null;
    peppolScheme: string | null;
    participantIdFallback: string | null;
    tradeLicenceNo: string | null;
    tradeLicenceAuthority: string | null;
    einvoicePayeeIban: string | null;
    einvoicePaymentMeansCode: string | null;
  };
  scope: {
    scope: string | null;
    band: string | null;
    goLiveDate: string | null;
    appointAspBy: string | null;
    mandatory: boolean;
    daysToGoLive: number | null;
  };
  asp: {
    capability: { status: string; externalAction: Localized };
    configured: boolean;
    connected: boolean;
    provider: { name: string | null; environment: string | null; error: string | null };
  };
  inbound: { enabled: boolean; endpoint: string };
  validation: { xsd: boolean; schematron: boolean; schematronVersion: string };
}

interface LayerSummary {
  available: boolean;
  valid: boolean;
  errorCount: number;
  errors: Array<{ id: string; message: string }>;
}
interface DocumentRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  validation: {
    valid: boolean;
    xsd: LayerSummary;
    schematron: LayerSummary;
    rules: LayerSummary;
  } | null;
}
interface ArchiveRow {
  id: string;
  kind: string;
  direction: string;
  documentNumber: string;
  sha256: string;
  retainUntil: string;
  createdAt: string;
}
interface InboundRow {
  id: string;
  supplierName: string | null;
  documentNumber: string;
  status: string;
  billId: string | null;
  error: string | null;
  receivedAt: string;
}

const NONE = "__none__";

interface FormState {
  peppolParticipantId: string;
  peppolScheme: string;
  tradeLicenceNo: string;
  tradeLicenceAuthority: string;
  einvoicePayeeIban: string;
  einvoicePaymentMeansCode: string;
  einvoiceScope: string;
  einvoiceTurnoverBand: string;
  einvoiceGoLiveDate: string;
}

function formFromView(view: SettingsView | undefined): FormState {
  return {
    peppolParticipantId: view?.identity.peppolParticipantId ?? "",
    peppolScheme: view?.identity.peppolScheme ?? "0235",
    tradeLicenceNo: view?.identity.tradeLicenceNo ?? "",
    tradeLicenceAuthority: view?.identity.tradeLicenceAuthority ?? "",
    einvoicePayeeIban: view?.identity.einvoicePayeeIban ?? "",
    einvoicePaymentMeansCode: view?.identity.einvoicePaymentMeansCode ?? NONE,
    einvoiceScope: view?.scope.scope ?? NONE,
    einvoiceTurnoverBand: view?.scope.band ?? NONE,
    einvoiceGoLiveDate: "",
  };
}

function layerText(l: LayerSummary | undefined, s: Copy): string {
  if (!l) return "—";
  if (!l.available) return s.unavailable;
  return l.valid ? s.valid : `${l.errorCount} ${s.invalid}`;
}

async function downloadArchive(companyId: string, row: ArchiveRow): Promise<boolean> {
  const res = await fetch(apiUrl(`/api/companies/${companyId}/einvoicing/archive/${row.id}`), {
    credentials: "include",
    headers: getAuthHeaders(),
  }).catch(() => null);
  if (!res || !res.ok) return false;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `einvoice-${row.kind}-${row.documentNumber}.xml`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export default function EInvoicingSettings() {
  const { company, companyId } = useActiveCompany();
  return (
    <CompanyEInvoicingSettings key={companyId} companyId={companyId} companyName={company?.name} />
  );
}

function CompanyEInvoicingSettings({
  companyId,
  companyName,
}: {
  companyId: string | undefined;
  companyName: string | undefined;
}) {
  const { locale } = useTranslation();
  const s: Copy = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();

  const settings = useQuery<SettingsView>({
    queryKey: ["/api/companies", companyId, "einvoicing", "settings"],
    enabled: !!companyId,
  });
  const documents = useQuery<{ items: DocumentRow[] }>({
    queryKey: ["/api/companies", companyId, "einvoicing", "documents"],
    enabled: !!companyId,
  });
  const archive = useQuery<{ items: ArchiveRow[] }>({
    queryKey: ["/api/companies", companyId, "einvoicing", "archive"],
    enabled: !!companyId,
  });
  const inbound = useQuery<{ items: InboundRow[] }>({
    queryKey: ["/api/companies", companyId, "einvoicing", "inbound"],
    enabled: !!companyId,
  });

  const view = settings.data;
  // Saved values come from the server; the form only holds the user's edits.
  const [edits, setEdits] = useState<Partial<FormState>>({});
  const form: FormState = { ...formFromView(view), ...edits };

  const save = useMutation({
    mutationFn: async () => {
      const blank = (v: string) => (v.trim() === "" || v === NONE ? null : v.trim());
      return apiRequest("PUT", `/api/companies/${companyId}/einvoicing/settings`, {
        peppolParticipantId: blank(form.peppolParticipantId),
        peppolScheme: blank(form.peppolScheme),
        tradeLicenceNo: blank(form.tradeLicenceNo),
        tradeLicenceAuthority: blank(form.tradeLicenceAuthority),
        einvoicePayeeIban: blank(form.einvoicePayeeIban.replace(/\s+/g, "")),
        einvoicePaymentMeansCode: blank(form.einvoicePaymentMeansCode),
        einvoiceScope: blank(form.einvoiceScope),
        einvoiceTurnoverBand: blank(form.einvoiceTurnoverBand),
        ...(form.einvoiceGoLiveDate ? { einvoiceGoLiveDate: form.einvoiceGoLiveDate } : {}),
      });
    },
    onSuccess: () => {
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "einvoicing"] });
      toast({ title: s.saved });
    },
    onError: () => toast({ title: s.saveFailed, variant: "destructive" }),
  });

  const paymentOptions = useMemo(
    () => [
      ["1", s.pmUndefined],
      ["10", s.pmCash],
      ["30", s.pmTransfer],
      ["42", s.pmBank],
      ["48", s.pmCard],
      ["49", s.pmDebit],
    ],
    [s]
  );

  const set = (k: keyof FormState) => (v: string) => setEdits((e) => ({ ...e, [k]: v }));

  return (
    <SettingsLayout>
      <div
        className="einvoice-surface max-w-narrow space-y-6 bg-background text-foreground"
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        <PageHeader
          eyebrow={s.eyebrow}
          title={s.title}
          description={s.description}
          icon={FileCheck2}
        />

        {/* After the trial the workspace is read-only (edits answer 402): say so up front. */}
        <TrialBanner endedOnly />

        {settings.isError ? (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <p className="text-muted-foreground">{s.loadFailed}</p>
            <Button variant="link" className="min-h-11" onClick={() => void settings.refetch()}>
              {s.retry}
            </Button>
          </div>
        ) : !view ? (
          <p className="text-muted-foreground">{s.loading}</p>
        ) : (
          <>
            {/* WQ5: choose the accredited partner (no default), appoint it, verify it. It comes
                first: it is the self-serve step, and the connection status below follows from it. */}
            {companyId && (
              <EInvoicePartnerCard companyId={companyId} companyName={companyName ?? ""} />
            )}

            {/* E1/E2: the configured accredited provider's guided connection (or "Not connected"). */}
            {companyId && <EInvoiceProviderCard companyId={companyId} />}

            <Card>
              <CardHeader>
                <CardTitle>{s.scopeTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>{s.scope}</Label>
                  <Select value={form.einvoiceScope} onValueChange={set("einvoiceScope")}>
                    <SelectTrigger data-testid="einvoice-scope" aria-label={s.scope}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      <SelectItem value="b2b">{s.scopeB2b}</SelectItem>
                      <SelectItem value="b2g">{s.scopeB2g}</SelectItem>
                      <SelectItem value="b2b_b2g">{s.scopeBoth}</SelectItem>
                      <SelectItem value="none">{s.scopeNone}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{s.band}</Label>
                  <Select
                    value={form.einvoiceTurnoverBand}
                    onValueChange={set("einvoiceTurnoverBand")}
                  >
                    <SelectTrigger data-testid="einvoice-band" aria-label={s.band}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      <SelectItem value="large">{s.bandLarge}</SelectItem>
                      <SelectItem value="standard">{s.bandStandard}</SelectItem>
                      <SelectItem value="government">{s.bandGovernment}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="golive">{s.goLiveOverride}</Label>
                  <DatePicker
                    id="golive"
                    value={form.einvoiceGoLiveDate}
                    onChange={(value) => set("einvoiceGoLiveDate")(value)}
                  />
                </div>
                <div className="text-sm md:col-span-3">
                  <span className="me-4">
                    {s.goLive}: <strong>{view.scope.goLiveDate ?? "—"}</strong>
                  </span>
                  <span className="me-4">
                    {s.appointBy}: <strong>{view.scope.appointAspBy ?? "—"}</strong>
                  </span>
                  <span className="me-4">
                    {s.daysLeft}: <strong>{view.scope.daysToGoLive ?? "—"}</strong>
                  </span>
                  <Badge variant={view.scope.mandatory ? "destructive" : "outline"}>
                    {view.scope.mandatory ? s.mandatory : s.notMandatory}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{s.identityTitle}</CardTitle>
                <CardDescription>
                  {s.participantHint} {view.identity.participantIdFallback ?? "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pid">{s.participantId}</Label>
                  <Input
                    id="pid"
                    inputMode="numeric"
                    placeholder={view.identity.participantIdFallback ?? ""}
                    value={form.peppolParticipantId}
                    onChange={(e) => set("peppolParticipantId")(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scheme">{s.scheme}</Label>
                  <Input
                    id="scheme"
                    value={form.peppolScheme}
                    onChange={(e) => set("peppolScheme")(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tl">{s.tradeLicence}</Label>
                  <Input
                    id="tl"
                    value={form.tradeLicenceNo}
                    onChange={(e) => set("tradeLicenceNo")(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tla">{s.tradeLicenceAuthority}</Label>
                  <Input
                    id="tla"
                    value={form.tradeLicenceAuthority}
                    onChange={(e) => set("tradeLicenceAuthority")(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="iban">{s.iban}</Label>
                  <Input
                    id="iban"
                    dir="ltr"
                    value={form.einvoicePayeeIban}
                    onChange={(e) => set("einvoicePayeeIban")(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{s.paymentMeans}</Label>
                  <Select
                    value={form.einvoicePaymentMeansCode}
                    onValueChange={set("einvoicePaymentMeansCode")}
                  >
                    <SelectTrigger aria-label={s.paymentMeans}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {paymentOptions.map(([code, label]) => (
                        <SelectItem key={code} value={code}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Button onClick={() => save.mutate()} disabled={save.isPending || !companyId}>
                    {s.save}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{s.validationTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  {s.xsd}: <strong>{view.validation.xsd ? s.available : s.unavailable}</strong>
                </div>
                <div>
                  {s.schematron} {view.validation.schematronVersion}:{" "}
                  <strong>{view.validation.schematron ? s.available : s.unavailable}</strong>
                </div>
                <div>
                  {s.rules}: <strong>{s.available}</strong>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{s.documentsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.invoice}</TableHead>
                  <TableHead>{s.status}</TableHead>
                  <TableHead>{s.attempts}</TableHead>
                  <TableHead>{s.nextRetry}</TableHead>
                  <TableHead>{s.xsd}</TableHead>
                  <TableHead>{s.schematron}</TableHead>
                  <TableHead>{s.rules}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.isError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground" role="alert">
                      {s.loadFailed}{" "}
                      <Button
                        variant="link"
                        size="sm"
                        className="min-h-11"
                        onClick={() => void documents.refetch()}
                      >
                        {s.retry}
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : documents.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground" role="status">
                      {s.loading}
                    </TableCell>
                  </TableRow>
                ) : (documents.data?.items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      {s.none}
                    </TableCell>
                  </TableRow>
                ) : (
                  (documents.data?.items ?? []).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link
                          href="/invoices"
                          className="inline-flex min-h-11 min-w-11 items-center"
                        >
                          <bdi>{d.invoiceNumber ?? d.invoiceId.slice(0, 8)}</bdi>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            d.status === "rejected" || d.status === "failed"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {word(s, "st", d.status)}
                        </Badge>
                        {d.lastError ? (
                          <div className="text-xs text-muted-foreground">{s.problemReported}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{d.attempts}</TableCell>
                      <TableCell>
                        {d.nextRetryAt ? formatDate(d.nextRetryAt, locale) : "—"}
                      </TableCell>
                      <TableCell>{layerText(d.validation?.xsd, s)}</TableCell>
                      <TableCell
                        title={d.validation?.schematron.errors
                          .map((e) => `${e.id}: ${e.message}`)
                          .join("\n")}
                      >
                        {layerText(d.validation?.schematron, s)}
                      </TableCell>
                      <TableCell
                        title={d.validation?.rules.errors
                          .map((e) => `${e.id}: ${e.message}`)
                          .join("\n")}
                      >
                        {layerText(d.validation?.rules, s)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{s.archiveTitle}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.invoice}</TableHead>
                  <TableHead>{s.direction}</TableHead>
                  <TableHead>{s.kind}</TableHead>
                  <TableHead>{s.hash}</TableHead>
                  <TableHead>{s.retainUntil}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {archive.isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground" role="alert">
                      {s.loadFailed}{" "}
                      <Button
                        variant="link"
                        size="sm"
                        className="min-h-11"
                        onClick={() => void archive.refetch()}
                      >
                        {s.retry}
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : archive.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground" role="status">
                      {s.loading}
                    </TableCell>
                  </TableRow>
                ) : (archive.data?.items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      {s.none}
                    </TableCell>
                  </TableRow>
                ) : (
                  (archive.data?.items ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <bdi>{a.documentNumber}</bdi>
                      </TableCell>
                      <TableCell>{word(s, "dir", a.direction)}</TableCell>
                      <TableCell>{word(s, "st", a.kind)}</TableCell>
                      <TableCell className="tabular-nums text-xs" dir="ltr">
                        {a.sha256.slice(0, 16)}…
                      </TableCell>
                      <TableCell>{formatDate(a.retainUntil, locale)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-11 w-11"
                          aria-label={s.download}
                          onClick={async () => {
                            if (companyId && !(await downloadArchive(companyId, a)))
                              toast({ title: s.downloadFailed, variant: "destructive" });
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{s.inboundTitle}</CardTitle>
            <CardDescription>
              {view?.inbound.enabled ? s.inboundEnabled : s.inboundDisabled}
            </CardDescription>
            {/* Spec 3.12: the inbound endpoint is developer detail, collapsed by default. */}
            {view ? (
              <details className="mt-2 text-small" data-testid="einvoice-developer-details">
                <summary className="cursor-pointer text-muted-foreground">
                  {s.developerDetails}
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{s.endpoint}</span>
                  <bdi className="break-all font-mono text-xs" translate="no">
                    {view.inbound.endpoint}
                  </bdi>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => {
                      void navigator.clipboard?.writeText(view.inbound.endpoint);
                      toast({ title: s.copied });
                    }}
                  >
                    {s.copy}
                  </Button>
                </div>
              </details>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.supplier}</TableHead>
                  <TableHead>{s.invoice}</TableHead>
                  <TableHead>{s.status}</TableHead>
                  <TableHead>{s.bill}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inbound.isError ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground" role="alert">
                      {s.loadFailed}{" "}
                      <Button
                        variant="link"
                        size="sm"
                        className="min-h-11"
                        onClick={() => void inbound.refetch()}
                      >
                        {s.retry}
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : inbound.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground" role="status">
                      {s.loading}
                    </TableCell>
                  </TableRow>
                ) : (inbound.data?.items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      {s.none}
                    </TableCell>
                  </TableRow>
                ) : (
                  (inbound.data?.items ?? []).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.supplierName ?? "—"}</TableCell>
                      <TableCell>
                        <bdi>{d.documentNumber}</bdi>
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.status === "bill_created" ? "default" : "outline"}>
                          {word(s, "st", d.status)}
                        </Badge>
                        {d.error ? (
                          <div className="text-xs text-muted-foreground">{s.problemReported}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {d.billId ? (
                          <Link
                            href="/bill-pay"
                            className="inline-flex min-h-11 min-w-11 items-center"
                          >
                            {d.billId.slice(0, 8)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}
