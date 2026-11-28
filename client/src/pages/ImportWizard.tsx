/**
 * Import data wizard (W5-B, R19-13, R02-16b): preview -> validate -> commit
 * CSV exports from Xero, QuickBooks Online, Zoho Books and Wafeq.
 * Server: /api/companies/:companyId/imports (server/routes/import.routes.ts).
 */
import { FileDrop } from "@/components/ui/file-drop";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { DatePicker } from "@/components/ui/date-picker";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { getAuthHeaders, refreshSession } from "@/lib/auth";
import { useTranslation } from "@/lib/i18n";
// Static on purpose: a failed secondary chunk must not lose a finished preview.
import ImportReview from "./import-wizard/ImportReview";
import { statusLabel } from "./import-wizard/issues";

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

/** History loader. React Query's signal reaches fetch, so a cancelled load stops. */
async function loadHistory(companyId: string, signal: AbortSignal): Promise<Job[]> {
  const url = apiUrl(`/api/companies/${companyId}/imports`);
  const send = () => fetch(url, { credentials: "include", headers: getAuthHeaders(), signal });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw new ApiError(res.statusText, res.status);
  return res.json();
}

export default function ImportWizard() {
  const { t, locale } = useTranslation();
  const kindLabel = (k: Kind) => (KINDS.includes(k) ? t[`importWizard.kind.${k}`] : k);
  const sourceLabel = (s: Source) =>
    s === "generic" ? t["importWizard.source.generic"] : (SOURCE_BRANDS[s] ?? s);
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  // Passive view of the provider's company query: still pending (loading, or paused offline
  // before its first response) does not mean the user has no company.
  const companiesQuery = useQuery({ queryKey: ["/api/companies"], enabled: false });
  const { isPending: companiesPending, isError: companiesFailed } = companiesQuery;
  // A failed load (first or refetch) is not the same as a loaded list with no company in it.
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
  // `text` is null while the selected file is still being read.
  const [file, setFile] = useState<{ name: string; text: string | null } | null>(null);
  // A preview belongs to the company it was run for; a company switch discards it for good.
  const [held, setHeld] = useState<{ companyId: string; job: Job } | null>(null);
  if (held && held.companyId !== companyId) setHeld(null);
  const job = held && held.companyId === companyId ? held.job : null;
  /** Replaces the shown job only if it is still the same one. */
  const updateJob = (next: Job) =>
    setHeld((h) => (h && h.job.id === next.id ? { ...h, job: next } : h));

  const history = useQuery<Job[]>({
    queryKey: ["/api/companies", companyId, "imports"],
    queryFn: ({ signal }) => loadHistory(companyId!, signal),
    enabled: !!companyId,
    retry: false,
  });

  const fail = (e: unknown) =>
    toast({
      title: t["importWizard.errors"],
      description: (e as Error)?.message,
      variant: "destructive",
    });
  const refresh = async (id: string | undefined) => {
    const queryKey = ["/api/companies", id, "imports"];
    await queryClient.cancelQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey });
  };

  // Each preview carries the sequence number of the selection that started it; a response
  // whose number is out of date updates nothing and raises no toast.
  const previewSeq = useRef(0);
  const readSeq = useRef(0);
  const preview = useMutation({
    mutationFn: (request: { seq: number; companyId: string; body: Record<string, unknown> }) =>
      apiRequest("POST", `/api/companies/${request.companyId}/imports/preview`, request.body),
    onSuccess: (j: Job, request) => {
      void refresh(request.companyId);
      if (request.seq === previewSeq.current) setHeld({ companyId: request.companyId, job: j });
    },
    onError: (e, request) => {
      if (request.seq === previewSeq.current) fail(e);
    },
  });
  const resetPreview = preview.reset;
  // Anything that invalidates a preview also drops the review held for it (the chosen file stays),
  // so Validate and Commit need a fresh Preview.
  const discardPreview = useCallback(() => {
    previewSeq.current += 1;
    resetPreview();
    setHeld(null);
  }, [resetPreview]);
  // Company switch or leaving the page. A layout effect, so the sequence moves on within the
  // commit itself, before any pending response callback can run.
  useLayoutEffect(() => discardPreview, [companyId, discardPreview]);

  const runPreview = () => {
    if (!companyId || !file || file.text === null) return;
    preview.mutate({
      seq: ++previewSeq.current,
      companyId,
      body: {
        kind,
        sourceSystem: source,
        csv: file.text,
        fileName: file.name,
        ...(needsCutOver(kind) && cutOver ? { cutOverDate: cutOver } : {}),
        ...(kind === "trial_balance" ? { arApMode: mode } : {}),
      },
    });
  };
  const validate = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/imports/${job!.id}/validate`),
    onSuccess: (j: Job) => updateJob(j),
    onError: fail,
  });
  const commit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/imports/${job!.id}/commit`),
    onSuccess: (j: Job) => {
      updateJob(j);
      void refresh(companyId);
      toast({ title: t["importWizard.committed"] });
    },
    onError: fail,
  });

  const onFile = async (f: File | undefined) => {
    // The previous file and its review go at once, not when the new read finishes.
    discardPreview();
    const read = ++readSeq.current;
    if (!f) return setFile(null);
    setFile({ name: f.name, text: null });
    try {
      const text = await f.text();
      if (read === readSeq.current) setFile({ name: f.name, text });
    } catch {
      if (read !== readSeq.current) return;
      setFile(null);
      toast({ title: t["importWizard.readFailed"], variant: "destructive" });
    }
  };

  // One history message at a time; its test id is `text-import-history-<state, lower case>`.
  const historyState = !companyId
    ? companiesPending
      ? "Loading"
      : companiesFailed
        ? "CompaniesError"
        : "NoCompany"
    : history.fetchStatus === "paused"
      ? history.data
        ? "PausedCached"
        : "Paused"
      : history.isPending
        ? "Loading"
        : history.isLoadingError
          ? "Error"
          : history.isRefetchError
            ? "Stale"
            : null;
  const historyFailed = historyState === "Error" || historyState === "Stale";
  const historyAlert = historyFailed || historyState === "CompaniesError";

  return (
    <SettingsLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader
          eyebrow={t["importWizard.eyebrow"]}
          title={t["importWizard.title"]}
          description={t["importWizard.description"]}
          icon={Upload}
        />
        <p className="text-sm text-muted-foreground">{t["importWizard.order"]}</p>

        <Card>
          <CardHeader>
            <CardTitle>{t["importWizard.step1"]}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t["importWizard.kindLabel"]}</Label>
              <Select value={kind} onValueChange={(v) => (discardPreview(), setKind(v as Kind))}>
                <SelectTrigger data-testid="select-import-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t["importWizard.sourceLabel"]}</Label>
              <Select
                value={source}
                onValueChange={(v) => (discardPreview(), setSource(v as Source))}
              >
                <SelectTrigger data-testid="select-import-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <bdi>{sourceLabel(s)}</bdi>
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
                {t["importWizard.fxHint"]}
              </p>
            )}
            {needsCutOver(kind) && (
              <div className="space-y-2">
                <Label htmlFor="cut-over">{t["importWizard.cutOver"]}</Label>
                <DatePicker
                  id="cut-over"
                  value={cutOver}
                  onChange={(v) => (discardPreview(), setCutOver(v))}
                />
              </div>
            )}
            {kind === "trial_balance" && (
              <div className="space-y-2">
                <Label>{t["importWizard.arApMode"]}</Label>
                <Select
                  value={mode}
                  onValueChange={(v) => (discardPreview(), setMode(v as "balance" | "documents"))}
                >
                  <SelectTrigger data-testid="select-import-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balance">{t["importWizard.modeBalance"]}</SelectItem>
                    <SelectItem value="documents">{t["importWizard.modeDocuments"]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="import-file">{t["importWizard.file"]}</Label>
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
                {t["importWizard.chooseFile"]}
              </p>
            )}
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button
                onClick={runPreview}
                disabled={!file || file.text === null || !companyId || preview.isPending}
                data-testid="button-import-preview"
              >
                <FileUp className="me-2 h-4 w-4" />
                {t[preview.isPending ? "importWizard.previewing" : "importWizard.preview"]}
              </Button>
              <Button variant="outline" asChild>
                <a href={apiUrl(`/api/companies/${companyId}/imports/templates/${kind}`)}>
                  <Download className="me-2 h-4 w-4" />
                  {t["importWizard.template"]}
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={apiUrl(`/api/companies/${companyId}/imports/chart-of-accounts/export`)}>
                  <Download className="me-2 h-4 w-4" />
                  {t["importWizard.exportCoa"]}
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {job && (
          <ImportReview
            job={job}
            locale={locale}
            onValidate={() => validate.mutate()}
            onCommit={() => commit.mutate()}
            isValidating={validate.isPending}
            isCommitting={commit.isPending}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t["importWizard.history"]}</CardTitle>
          </CardHeader>
          <CardContent>
            {historyState && (
              <div
                className={`flex flex-wrap items-center gap-2 text-sm ${historyAlert ? "text-destructive" : "text-muted-foreground"}`}
                role={historyAlert ? "alert" : "status"}
                data-testid={`text-import-history-${historyState.toLowerCase()}`}
              >
                <p>{t[`importWizard.history${historyState}`]}</p>
                {historyFailed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void history.refetch()}
                    disabled={history.isFetching}
                    data-testid="button-import-history-retry"
                  >
                    {t["importWizard.historyRetry"]}
                  </Button>
                )}
              </div>
            )}
            {!!companyId && history.data?.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-import-history-empty">
                {t["importWizard.historyEmpty"]}
              </p>
            )}
            <Table>
              <TableBody>
                {(history.data ?? []).map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>{kindLabel(j.kind)}</TableCell>
                    <TableCell>
                      <bdi>{sourceLabel(j.sourceSystem)}</bdi>
                    </TableCell>
                    <TableCell>{j.fileName ?? ""}</TableCell>
                    <TableCell>
                      <Badge variant={j.status === "committed" ? "default" : "outline"}>
                        {statusLabel(j.status, t)}
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
