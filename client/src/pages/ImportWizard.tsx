/**
 * Import data wizard (W5-B, R19-13, R02-16b): preview -> validate -> commit
 * CSV exports from Xero, QuickBooks Online, Zoho Books and Wafeq.
 * Server: /api/companies/:companyId/imports (server/routes/import.routes.ts).
 */
import { FileDrop } from "@/components/ui/file-drop";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { DatePicker } from "@/components/ui/date-picker";
import { lazy, Suspense, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const ImportReview = lazy(() => import("./import-wizard/ImportReview"));

type Kind =
  | "chart_of_accounts"
  | "trial_balance"
  | "customers"
  | "vendors"
  | "items"
  | "open_invoices"
  | "open_bills";
type Source = "xero" | "quickbooks" | "zoho" | "wafeq" | "generic";

const SOURCE_BRANDS = {
  xero: "Xero",
  quickbooks: "QuickBooks Online",
  zoho: "Zoho Books",
  wafeq: "Wafeq",
} satisfies Record<Exclude<Source, "generic">, string>;

export interface Issue {
  row: number | null;
  level: "error" | "warning";
  code: string;
  message: string;
}
export interface Job {
  id: string;
  kind: Kind;
  sourceSystem: Source;
  status: string;
  fileName: string | null;
  cutOverDate: string | null;
  rowCount: number;
  rows: Array<Record<string, unknown>>;
  issues: Issue[];
  summary: { mapping?: Record<string, string>; unmappedColumns?: string[] } & Record<
    string,
    unknown
  >;
  result: Record<string, unknown> | null;
  createdAt: string;
}

const COPY = {
  en: {
    eyebrow: "Setup",
    title: "Import data",
    description:
      "Bring your books over from Xero, QuickBooks Online, Zoho Books or Wafeq. Each file is previewed and validated before anything is written.",
    step1: "1. Choose what to import",
    kind: "Data",
    source: "Exported from",
    cutOver: "Cut-over date",
    arApMode: "Receivables and payables",
    modeBalance: "Post A/R and A/P balances from the trial balance",
    modeDocuments: "Carry A/R and A/P by importing open invoices and bills",
    file: "CSV file",
    template: "Download template",
    preview: "Preview",
    step3: "3. Commit",
    committed: "Import committed",
    errors: "Errors",
    history: "Import history",
    exportCoa: "Export chart of accounts (CSV)",
    readFailed: "Could not read the file",
    chooseFile: "Choose a CSV file to enable Preview.",
    previewing: "Previewing...",
    historyLoading: "Loading import history...",
    historyError: "Could not load the import history. Refresh the page to try again.",
    historyEmpty: "No imports yet. Your previewed and committed files will appear here.",
    status: {
      previewed: "Previewed",
      validated: "Validated",
      committed: "Committed",
      failed: "Failed",
      committing: "Committing",
    } as Record<string, string>,
    kinds: {
      chart_of_accounts: "Chart of accounts",
      trial_balance: "Opening balances (trial balance)",
      customers: "Customers",
      vendors: "Vendors",
      items: "Items / products",
      open_invoices: "Open sales invoices",
      open_bills: "Open bills",
    } as Record<Kind, string>,
    sources: {
      ...SOURCE_BRANDS,
      generic: "Template / other",
    } as Record<Source, string>,
    order:
      "Recommended order: chart of accounts, then opening balances, then contacts and items, then open invoices and bills.",
    fxHint:
      "Foreign-currency documents are supported: amounts stay in the document currency (Currency column) and are converted at the document-date rate, from an Exchange Rate column or your Exchange Rates. Settlement books the realised FX difference.",
  },
  ar: {
    eyebrow: "الإعداد",
    title: "استيراد البيانات",
    description:
      "انقل دفاترك من Xero أو QuickBooks Online أو Zoho Books أو Wafeq. عاين كل ملف وتحقّق منه قبل اعتماد الاستيراد.",
    step1: "١. اختر ما تريد استيراده",
    kind: "البيانات",
    source: "مُصدَّرة من",
    cutOver: "تاريخ الانتقال",
    arApMode: "الذمم المدينة والدائنة",
    modeBalance: "ترحيل أرصدة الذمم من ميزان المراجعة",
    modeDocuments: "تمثيل الذمم باستيراد الفواتير المفتوحة",
    file: "ملف CSV",
    template: "تنزيل النموذج",
    preview: "معاينة",
    step3: "٣. التأكيد",
    committed: "تم تأكيد الاستيراد",
    errors: "أخطاء",
    history: "سجل الاستيراد",
    exportCoa: "تصدير دليل الحسابات (CSV)",
    readFailed: "تعذرت قراءة الملف",
    chooseFile: "اختر ملف CSV لتفعيل المعاينة.",
    previewing: "جارٍ المعاينة...",
    historyLoading: "جارٍ تحميل سجل الاستيراد...",
    historyError: "تعذر تحميل سجل الاستيراد. حدّث الصفحة وحاول مرة أخرى.",
    historyEmpty: "لا توجد عمليات استيراد بعد. ستظهر هنا الملفات التي عاينتها أو أكدتها.",
    status: {
      previewed: "تمت المعاينة",
      validated: "تم التحقق",
      committed: "تم التأكيد",
      failed: "فشل",
      committing: "جارٍ التأكيد",
    } as Record<string, string>,
    kinds: {
      chart_of_accounts: "دليل الحسابات",
      trial_balance: "الأرصدة الافتتاحية (ميزان المراجعة)",
      customers: "العملاء",
      vendors: "الموردون",
      items: "الأصناف / المنتجات",
      open_invoices: "فواتير المبيعات المفتوحة",
      open_bills: "فواتير الموردين المفتوحة",
    } as Record<Kind, string>,
    sources: {
      ...SOURCE_BRANDS,
      generic: "نموذج / أخرى",
    } as Record<Source, string>,
    order:
      "الترتيب المقترح: دليل الحسابات، ثم الأرصدة الافتتاحية، ثم جهات الاتصال والأصناف، ثم الفواتير المفتوحة.",
    fxHint:
      "المستندات بالعملات الأجنبية مدعومة: تبقى المبالغ بعملة المستند (عمود العملة) وتُحوَّل بسعر تاريخ المستند من عمود سعر الصرف أو من أسعار الصرف لديك. ويُقيَّد فرق الصرف المحقق عند التسوية.",
  },
};

const KINDS: Kind[] = [
  "chart_of_accounts",
  "trial_balance",
  "customers",
  "vendors",
  "items",
  "open_invoices",
  "open_bills",
];
const SOURCES: Source[] = ["xero", "quickbooks", "zoho", "wafeq", "generic"];
const needsCutOver = (k: Kind) =>
  k === "trial_balance" || k === "open_invoices" || k === "open_bills";

/** Initial kind from `?kind=` (e.g. the Chart of Accounts "Import CSV" button). */
function kindFromSearch(search: string): Kind {
  const k = new URLSearchParams(search).get("kind");
  return (KINDS as string[]).includes(k ?? "") ? (k as Kind) : "chart_of_accounts";
}

export default function ImportWizard() {
  const { locale } = useI18n();
  const c = COPY[locale === "ar" ? "ar" : "en"];
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [kind, setKind] = useState<Kind>(() =>
    kindFromSearch(typeof window === "undefined" ? "" : window.location.search)
  );
  const [source, setSource] = useState<Source>("xero");
  // WQ7: onboarding's "Opening balances" choice links here with ?cutover=YYYY-MM-DD.
  const [cutOver, setCutOver] = useState(() => {
    const v =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("cutover");
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  });
  const [mode, setMode] = useState<"balance" | "documents">("balance");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  const history = useQuery<Job[]>({
    queryKey: ["/api/companies", companyId, "imports"],
    enabled: !!companyId,
    retry: false,
  });

  const fail = (e: unknown) =>
    toast({ title: c.errors, description: (e as Error)?.message, variant: "destructive" });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "imports"] });

  const preview = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/imports/preview`, {
        kind,
        sourceSystem: source,
        csv: file?.text ?? "",
        fileName: file?.name ?? null,
        ...(needsCutOver(kind) && cutOver ? { cutOverDate: cutOver } : {}),
        ...(kind === "trial_balance" ? { arApMode: mode } : {}),
      }),
    onSuccess: (j: Job) => {
      setJob(j);
      refresh();
    },
    onError: fail,
  });
  const validate = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/imports/${job!.id}/validate`),
    onSuccess: (j: Job) => setJob(j),
    onError: fail,
  });
  const commit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/imports/${job!.id}/commit`),
    onSuccess: (j: Job) => {
      setJob(j);
      refresh();
      toast({ title: c.committed });
    },
    onError: fail,
  });

  const onFile = async (f: File | undefined) => {
    if (!f) {
      setJob(null);
      return setFile(null);
    }
    try {
      setFile({ name: f.name, text: await f.text() });
      setJob(null);
    } catch {
      toast({ title: c.readFailed, variant: "destructive" });
    }
  };

  return (
    <SettingsLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader eyebrow={c.eyebrow} title={c.title} description={c.description} icon={Upload} />
        <p className="text-sm text-muted-foreground">{c.order}</p>

        <Card>
          <CardHeader>
            <CardTitle>{c.step1}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{c.kind}</Label>
              <Select value={kind} onValueChange={(v) => (setKind(v as Kind), setJob(null))}>
                <SelectTrigger data-testid="select-import-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {c.kinds[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{c.source}</Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger data-testid="select-import-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <bdi>{c.sources[s]}</bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(kind === "open_invoices" || kind === "open_bills") && (
              <p
                className="text-sm text-muted-foreground md:col-span-2"
                data-testid="text-import-fx-hint"
              >
                {c.fxHint}
              </p>
            )}
            {needsCutOver(kind) && (
              <div className="space-y-2">
                <Label htmlFor="cut-over">{c.cutOver}</Label>
                <DatePicker id="cut-over" value={cutOver} onChange={(v) => setCutOver(v)} />
              </div>
            )}
            {kind === "trial_balance" && (
              <div className="space-y-2">
                <Label>{c.arApMode}</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as "balance" | "documents")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balance">{c.modeBalance}</SelectItem>
                    <SelectItem value="documents">{c.modeDocuments}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="import-file">{c.file}</Label>
              <FileDrop
                id="import-file"
                accept=".csv,text/csv"
                inputTestId="input-import-file"
                value={file?.name}
                onFiles={([f]) => onFile(f)}
                onClear={() => onFile(undefined)}
              />
            </div>
            {!file && (
              <p
                className="text-sm text-muted-foreground md:col-span-2"
                data-testid="text-import-choose-file"
              >
                {c.chooseFile}
              </p>
            )}
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button
                onClick={() => preview.mutate()}
                disabled={!file || !companyId || preview.isPending}
                data-testid="button-import-preview"
              >
                <FileUp className="me-2 h-4 w-4" />
                {preview.isPending ? c.previewing : c.preview}
              </Button>
              <Button variant="outline" asChild>
                <a href={apiUrl(`/api/companies/${companyId}/imports/templates/${kind}`)}>
                  <Download className="me-2 h-4 w-4" />
                  {c.template}
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={apiUrl(`/api/companies/${companyId}/imports/chart-of-accounts/export`)}>
                  <Download className="me-2 h-4 w-4" />
                  {c.exportCoa}
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {job && (
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground" role="status">
                {c.previewing}
              </p>
            }
          >
            <ImportReview
              job={job}
              locale={locale}
              statusLabels={c.status}
              errorsLabel={c.errors}
              onValidate={() => validate.mutate()}
              onCommit={() => commit.mutate()}
              isValidating={validate.isPending}
              isCommitting={commit.isPending}
            />
          </Suspense>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{c.history}</CardTitle>
          </CardHeader>
          <CardContent>
            {history.isLoading && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-import-history-loading"
              >
                {c.historyLoading}
              </p>
            )}
            {history.isError && (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="text-import-history-error"
              >
                {c.historyError}
              </p>
            )}
            {!history.isLoading && !history.isError && (history.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-import-history-empty">
                {c.historyEmpty}
              </p>
            )}
            <Table>
              <TableBody>
                {(history.data ?? []).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>{c.kinds[j.kind] ?? j.kind}</TableCell>
                    <TableCell>
                      <bdi>{c.sources[j.sourceSystem] ?? j.sourceSystem}</bdi>
                    </TableCell>
                    <TableCell>{j.fileName ?? ""}</TableCell>
                    <TableCell>
                      <Badge variant={j.status === "committed" ? "default" : "outline"}>
                        {c.status[j.status] ?? j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(j.createdAt).toLocaleString(locale === "ar" ? "ar-AE" : "en-AE")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}
