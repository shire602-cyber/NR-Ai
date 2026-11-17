import { useState } from "react";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders } from "@/lib/auth";

// ZATCA (KSA) Phase 2 onboarding status (W4-C, R07-14). Unconfigured
// deployments get 503 ZATCA_NOT_CONFIGURED and this page says so plainly.

const COPY = {
  en: {
    eyebrow: "Settings",
    title: "KSA e-invoicing (ZATCA)",
    description:
      "Register each invoicing unit with ZATCA; standard invoices are then cleared and simplified invoices reported.",
    notOnboarded: "Not connected",
    notConfigured: "Connecting to ZATCA is not available yet",
    onboarded: "Connected",
    environment: "Environment",
    egsTitle: "EGS units",
    newEgs: "Register an EGS unit",
    name: "Unit name",
    vat: "VAT number (15 digits, 3…3)",
    orgName: "Organisation name",
    orgUnit: "Branch / organisational unit",
    invoiceTypes: "Invoice types",
    typesBoth: "Standard and simplified",
    typesStandard: "Standard only",
    typesSimplified: "Simplified only",
    address: "Location address",
    industry: "Industry",
    sellerAr: "Seller name (Arabic)",
    crn: "Commercial registration (10 digits)",
    street: "Street",
    building: "Building no. (4 digits)",
    district: "District",
    city: "City",
    postal: "Postal code (5 digits)",
    create: "Generate keys and CSR",
    otp: "One-time code from ZATCA",
    onboard: "Onboard",
    status: "Status",
    icv: "Invoice counter",
    created: "EGS unit registered; CSR generated",
    onboardedToast: "EGS unit onboarded with a production CSID",
    failed: "Request failed",
    none: "None yet",
    einvoicingLink: "UAE e-invoicing settings",
    loading: "Loading…",
  },
  ar: {
    eyebrow: "الإعدادات",
    title: "الفوترة الإلكترونية في السعودية (هيئة الزكاة)",
    description:
      "سجّل كل وحدة لإصدار الفواتير لدى هيئة الزكاة؛ ثم تُعتمد الفواتير الضريبية وتُبلَّغ الفواتير المبسطة.",
    notOnboarded: "غير متصل",
    notConfigured: "الربط مع هيئة الزكاة غير متاح بعد",
    onboarded: "متصل",
    environment: "البيئة",
    egsTitle: "وحدات إصدار الفواتير",
    newEgs: "تسجيل وحدة إصدار فواتير",
    name: "اسم الوحدة",
    vat: "الرقم الضريبي (15 رقماً يبدأ وينتهي بـ 3)",
    orgName: "اسم المنشأة",
    orgUnit: "الفرع / الوحدة التنظيمية",
    invoiceTypes: "أنواع الفواتير",
    typesBoth: "ضريبية ومبسطة",
    typesStandard: "ضريبية فقط",
    typesSimplified: "مبسطة فقط",
    address: "عنوان الموقع",
    industry: "النشاط",
    sellerAr: "اسم البائع (بالعربية)",
    crn: "السجل التجاري (10 أرقام)",
    street: "الشارع",
    building: "رقم المبنى (4 أرقام)",
    district: "الحي",
    city: "المدينة",
    postal: "الرمز البريدي (5 أرقام)",
    create: "إنشاء المفاتيح وطلب الشهادة",
    otp: "رمز التحقق من هيئة الزكاة",
    onboard: "تسجيل",
    status: "الحالة",
    icv: "عداد الفواتير",
    created: "تم تسجيل الوحدة وإنشاء طلب الشهادة",
    onboardedToast: "تم تسجيل الوحدة والحصول على شهادة الإنتاج",
    failed: "تعذّر تنفيذ الطلب",
    none: "لا يوجد بعد",
    einvoicingLink: "إعدادات الفوترة الإلكترونية في الإمارات",
    loading: "جارٍ التحميل…",
  },
} as const;

interface EgsUnit {
  id: string;
  name: string;
  environment: string;
  status: string;
  statusDetail: string | null;
  icv: number;
  vatNumber: string;
}

interface ZatcaStatus {
  httpStatus: number;
  code?: string;
  configured?: boolean;
  environment?: string;
  onboarded?: boolean;
  capability?: { status: string; externalAction: { en: string; ar: string } };
  egsUnits?: EgsUnit[];
}

async function fetchStatus(companyId: string): Promise<ZatcaStatus> {
  const res = await fetch(apiUrl(`/api/companies/${companyId}/zatca/status`), {
    credentials: "include",
    headers: getAuthHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as Omit<ZatcaStatus, "httpStatus">;
  return { httpStatus: res.status, ...body };
}

const EMPTY = {
  name: "",
  vatNumber: "",
  organizationName: "",
  organizationUnit: "",
  invoiceTypes: "1100",
  locationAddress: "",
  industry: "",
  nameAr: "",
  crn: "",
  street: "",
  buildingNumber: "",
  district: "",
  city: "",
  postalZone: "",
};

/** G8: ZATCA environment / unit status as a label, never the raw value. */
const ENVIRONMENT_LABELS: Record<string, { en: string; ar: string }> = {
  sandbox: { en: "Test", ar: "تجريبي" },
  developer: { en: "Test", ar: "تجريبي" },
  simulation: { en: "Simulation", ar: "محاكاة" },
  production: { en: "Production", ar: "إنتاج" },
  pending: { en: "Pending", ar: "قيد الانتظار" },
  compliance: { en: "Compliance checks", ar: "فحوص الامتثال" },
  onboarded: { en: "Connected", ar: "متصل" },
};

function environmentLabel(value: string | null | undefined, lang: "en" | "ar"): string {
  if (!value) return "—";
  const label = ENVIRONMENT_LABELS[value.toLowerCase()];
  return label ? label[lang] : value;
}

export default function ZatcaSettings() {
  const { locale } = useTranslation();
  const s = COPY[locale === "ar" ? "ar" : "en"];
  const lang = locale === "ar" ? "ar" : "en";
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [form, setForm] = useState(EMPTY);
  const [otp, setOtp] = useState<Record<string, string>>({});

  const status = useQuery<ZatcaStatus>({
    queryKey: ["zatca-status", companyId],
    queryFn: () => fetchStatus(companyId as string),
    enabled: !!companyId,
  });
  const configured = status.data?.httpStatus === 200 && status.data.configured === true;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["zatca-status", companyId] });
  const fail = (err: Error) =>
    toast({ title: s.failed, description: err.message, variant: "destructive" });

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/zatca/egs-units`, {
        name: form.name,
        vatNumber: form.vatNumber,
        organizationName: form.organizationName,
        organizationUnit: form.organizationUnit,
        invoiceTypes: form.invoiceTypes,
        locationAddress: form.locationAddress,
        industry: form.industry,
        seller: {
          nameAr: form.nameAr,
          crn: form.crn || null,
          address: {
            street: form.street,
            buildingNumber: form.buildingNumber,
            district: form.district,
            city: form.city,
            postalZone: form.postalZone,
          },
        },
      }),
    onSuccess: () => {
      setForm(EMPTY);
      invalidate();
      toast({ title: s.created });
    },
    onError: fail,
  });

  const onboard = useMutation({
    mutationFn: (egsId: string) =>
      apiRequest("POST", `/api/companies/${companyId}/zatca/egs-units/${egsId}/onboard`, {
        otp: otp[egsId] ?? "",
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: s.onboardedToast });
    },
    onError: fail,
  });

  const field = (key: keyof typeof EMPTY, label: string, opts: { dir?: "ltr" | "rtl" } = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`zatca-${key}`}>{label}</Label>
      <Input
        id={`zatca-${key}`}
        dir={opts.dir}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  const onboarded = status.data?.onboarded === true;

  return (
    <SettingsLayout>
      <div className="max-w-narrow space-y-6" dir={lang === "ar" ? "rtl" : "ltr"}>
        <PageHeader
          eyebrow={s.eyebrow}
          title={s.title}
          description={s.description}
          secondaryActions={
            <Button asChild variant="outline">
              <Link href="/settings/einvoicing">{s.einvoicingLink}</Link>
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              {s.title}
              {status.isLoading ? null : onboarded ? (
                <StatusBadge tone="success" data-testid="zatca-status">
                  {s.onboarded}
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral" data-testid="zatca-status">
                  {s.notOnboarded}
                </StatusBadge>
              )}
            </CardTitle>
            <CardDescription>
              {status.isLoading
                ? s.loading
                : configured
                  ? `${s.environment}: ${environmentLabel(status.data?.environment, lang)}`
                  : `${s.notConfigured}.`}
            </CardDescription>
          </CardHeader>
        </Card>

        {configured ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{s.egsTitle}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{s.name}</TableHead>
                      <TableHead>{s.status}</TableHead>
                      <TableHead>{s.icv}</TableHead>
                      <TableHead>{s.otp}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(status.data?.egsUnits ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          {s.none}
                        </TableCell>
                      </TableRow>
                    ) : (
                      (status.data?.egsUnits ?? []).map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>{u.name}</TableCell>
                          <TableCell>
                            <StatusBadge tone={u.status === "production" ? "success" : "neutral"}>
                              {environmentLabel(u.status, lang)}
                            </StatusBadge>
                            {u.statusDetail ? (
                              <div className="text-xs text-muted-foreground">{u.statusDetail}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>{u.icv}</TableCell>
                          <TableCell>
                            {u.status === "production" ? (
                              "—"
                            ) : (
                              <div className="flex gap-2">
                                <Input
                                  aria-label={s.otp}
                                  inputMode="numeric"
                                  maxLength={6}
                                  className="w-28"
                                  value={otp[u.id] ?? ""}
                                  onChange={(e) =>
                                    setOtp((o) => ({ ...o, [u.id]: e.target.value }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  disabled={onboard.isPending || !/^\d{6}$/.test(otp[u.id] ?? "")}
                                  onClick={() => onboard.mutate(u.id)}
                                >
                                  {s.onboard}
                                </Button>
                              </div>
                            )}
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
                <CardTitle>{s.newEgs}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {field("name", s.name)}
                {field("vatNumber", s.vat, { dir: "ltr" })}
                {field("organizationName", s.orgName)}
                {field("organizationUnit", s.orgUnit)}
                <div className="space-y-2">
                  <Label htmlFor="zatca-types">{s.invoiceTypes}</Label>
                  <Select
                    value={form.invoiceTypes}
                    onValueChange={(value) => setForm((f) => ({ ...f, invoiceTypes: value }))}
                  >
                    <SelectTrigger id="zatca-types">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1100">{s.typesBoth}</SelectItem>
                      <SelectItem value="1000">{s.typesStandard}</SelectItem>
                      <SelectItem value="0100">{s.typesSimplified}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {field("locationAddress", s.address)}
                {field("industry", s.industry)}
                {field("nameAr", s.sellerAr, { dir: "rtl" })}
                {field("crn", s.crn, { dir: "ltr" })}
                {field("street", s.street)}
                {field("buildingNumber", s.building, { dir: "ltr" })}
                {field("district", s.district)}
                {field("city", s.city)}
                {field("postalZone", s.postal, { dir: "ltr" })}
                <div className="md:col-span-2">
                  <Button onClick={() => create.mutate()} disabled={create.isPending || !companyId}>
                    {s.create}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </SettingsLayout>
  );
}
