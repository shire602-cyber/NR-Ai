import { useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { isSaudiCompany } from "@/lib/company-country";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";
import { EInvoiceProviderCard } from "@/components/einvoice/EInvoiceProviderCard";

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
    validationTitle: "Validation",
    xsd: "UBL 2.1 XSD",
    schematron: "PINT AE schematron",
    rules: "PINT AE rule list",
    available: "Available",
    unavailable: "Not available in this deployment",
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
    inboundEnabled: "Inbound webhook enabled",
    inboundDisabled: "Inbound disabled: webhook secret not configured",
    endpoint: "Endpoint",
    supplier: "Supplier",
    bill: "Draft bill",
    zatcaLink: "KSA (ZATCA) settings",
    loading: "Loading…",
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
    validationTitle: "التحقق",
    xsd: "مخطط UBL 2.1",
    schematron: "قواعد PINT AE الرسمية",
    rules: "قائمة قواعد PINT AE",
    available: "متاح",
    unavailable: "غير متاح في هذا النشر",
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
    inboundDisabled: "الاستقبال معطّل: لم يتم إعداد سر الربط",
    endpoint: "نقطة الاستقبال",
    supplier: "المورد",
    bill: "فاتورة مورد مسودة",
    zatcaLink: "إعدادات السعودية (هيئة الزكاة)",
    loading: "جارٍ التحميل…",
  },
} as const;

type Copy = Record<keyof (typeof COPY)["en"], string>;

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

async function downloadArchive(companyId: string, row: ArchiveRow) {
  const res = await fetch(apiUrl(`/api/companies/${companyId}/einvoicing/archive/${row.id}`), {
    credentials: "include",
    headers: getAuthHeaders(),
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `einvoice-${row.kind}-${row.documentNumber}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EInvoicingSettings() {
  const { locale } = useTranslation();
  const s: Copy = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { company: activeCompany } = useActiveCompany();

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
    onError: (err: Error) =>
      toast({ title: s.saveFailed, description: err.message, variant: "destructive" }),
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
    <div className="max-w-narrow space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={s.eyebrow}
        title={s.title}
        description={s.description}
        icon={FileCheck2}
        actions={
          isSaudiCompany(activeCompany) ? (
            <Button asChild variant="outline">
              <Link href="/settings/zatca">{s.zatcaLink}</Link>
            </Button>
          ) : undefined
        }
      />

      {!view ? (
        <p className="text-muted-foreground">{s.loading}</p>
      ) : (
        <>
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
                <Input
                  id="golive"
                  type="date"
                  value={form.einvoiceGoLiveDate}
                  onChange={(e) => set("einvoiceGoLiveDate")(e.target.value)}
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
              {(documents.data?.items ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    {s.none}
                  </TableCell>
                </TableRow>
              ) : (
                (documents.data?.items ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href="/invoices">{d.invoiceNumber ?? d.invoiceId.slice(0, 8)}</Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "rejected" || d.status === "failed"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {d.status}
                      </Badge>
                      {d.lastError ? (
                        <div className="text-xs text-muted-foreground">{d.lastError}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>{d.attempts}</TableCell>
                    <TableCell>
                      {d.nextRetryAt ? new Date(d.nextRetryAt).toLocaleString(locale) : "—"}
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
              {(archive.data?.items ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    {s.none}
                  </TableCell>
                </TableRow>
              ) : (
                (archive.data?.items ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.documentNumber}</TableCell>
                    <TableCell>{a.direction}</TableCell>
                    <TableCell>{a.kind}</TableCell>
                    <TableCell className="tabular-nums text-xs" dir="ltr">
                      {a.sha256.slice(0, 16)}…
                    </TableCell>
                    <TableCell>{a.retainUntil}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={s.download}
                        onClick={() => companyId && downloadArchive(companyId, a)}
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
            {view ? (
              <span className="ms-2 font-mono text-xs" dir="ltr">
                {s.endpoint}: <span translate="no">{view.inbound.endpoint}</span>
              </span>
            ) : null}
          </CardDescription>
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
              {(inbound.data?.items ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {s.none}
                  </TableCell>
                </TableRow>
              ) : (
                (inbound.data?.items ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.supplierName ?? "—"}</TableCell>
                    <TableCell>{d.documentNumber}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "bill_created" ? "default" : "outline"}>
                        {d.status}
                      </Badge>
                      {d.error ? (
                        <div className="text-xs text-muted-foreground">{d.error}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {d.billId ? <Link href="/bill-pay">{d.billId.slice(0, 8)}</Link> : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
