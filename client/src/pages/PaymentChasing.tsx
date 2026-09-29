import { PageHeader } from "@/components/ui/page-header";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import {
  Send,
  Inbox,
  BarChart3,
  Settings as SettingsIcon,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Ban,
  AlertCircle,
} from "lucide-react";
import { messages as pageMessages } from "./PaymentChasing.i18n";

// Threshold above which "Chase all" requires explicit confirmation. Picked to
// match a conservative "is this batch big enough to be embarrassing if wrong"
// gut-check; tweak if customer feedback suggests another number.
const BULK_CONFIRM_THRESHOLD = 10;

// Known placeholder tokens — must mirror RenderContext keys in the service.
// The template editor highlights any tokens outside this set so a typo like
// `{customername}` doesn't silently render as literal text in production.
const KNOWN_PLACEHOLDERS = [
  "customerName",
  "invoiceNumber",
  "amount",
  "currency",
  "dueDate",
  "daysOverdue",
  "paymentLink",
  "senderName",
] as const;

// ─── Types (inline; mirror server contracts) ────────────────────────────────

type AgingBucket = "1-7" | "8-30" | "31-60" | "60+";
type ChaseLevel = 1 | 2 | 3 | 4;

interface AgingRow {
  invoice: {
    id: string;
    number: string;
    customerName: string;
    currency: string;
    total: number;
    dueDate: string | null;
    status: string;
    contactId?: string | null;
    chaseLevel?: number;
    lastChasedAt?: string | null;
    doNotChase?: boolean;
  };
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
  recommendedLevel: ChaseLevel;
  nextLevel?: ChaseLevel;
}

interface OverdueResponse {
  rows: AgingRow[];
  buckets: Record<AgingBucket, number>;
  totalOutstanding: number;
}

interface QueueResponse {
  queue: AgingRow[];
  groups: Array<{
    contactId: string | null;
    customerName: string;
    rows: AgingRow[];
    totalOutstanding: number;
    currency: string;
    recommendedLevel: ChaseLevel;
  }>;
  config: {
    frequencyDays: number;
    maxLevel: number;
    preferredMethod: string;
    autoChaseEnabled: boolean;
  };
}

interface ChaseRecord {
  id: string;
  invoiceId: string;
  level: number;
  method: string;
  language: string;
  messageText: string;
  daysOverdueAtSend: number;
  amountAtSend: number;
  status: string;
  sentAt: string;
  paidAt: string | null;
}

interface Effectiveness {
  totalChases: number;
  uniqueInvoices: number;
  paidAfterChase: number;
  paidWithin7: number;
  paidWithin14: number;
  paidWithin30: number;
  conversionRate: number;
  avgDaysToPayment: number | null;
  byLevel: Record<string, { sent: number; paid: number }>;
}

interface Template {
  id: string;
  companyId: string | null;
  level: number;
  language: string;
  subject: string | null;
  body: string;
  isDefault: boolean;
}

interface ChaseConfig {
  companyId: string;
  autoChaseEnabled: boolean;
  chaseFrequencyDays: number;
  maxLevel: number;
  preferredMethod: string;
  doNotChaseContactIds: string;
  defaultLanguage: string;
}

interface BulkSendResult {
  invoiceId: string;
  level: number;
  status: "sent" | "failed" | "skipped_max_level" | "skipped_no_template" | string;
  error?: string;
}

interface BulkSendResponse {
  sent: number;
  skipped: number;
  failed: number;
  results: BulkSendResult[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function levelLabel(level: number, locale: string): string {
  // i18n-ignore: already bilingual (paired with the Arabic array below)
  const en = ["", "Friendly reminder", "Firm reminder", "Urgent notice", "Final notice"];
  const ar = ["", "تذكير ودي", "تذكير حازم", "إشعار عاجل", "إشعار نهائي"];
  return (locale === "ar" ? ar : en)[level] || `Level ${level}`;
}

function levelColor(level: number): string {
  switch (level) {
    case 1:
      return "bg-info-subtle text-info-subtle-foreground ";
    case 2:
      return "bg-warning-subtle text-warning-subtle-foreground ";
    case 3:
      return "bg-warning-subtle text-warning-subtle-foreground ";
    case 4:
      return "bg-danger-subtle text-danger-subtle-foreground ";
    default:
      return "bg-muted text-foreground";
  }
}

function bucketColor(b: AgingBucket): string {
  switch (b) {
    case "1-7":
      return "bg-info-subtle ";
    case "8-30":
      return "bg-warning-subtle ";
    case "31-60":
      return "bg-warning-subtle ";
    case "60+":
      return "bg-danger-subtle ";
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PaymentChasing() {
  const tr = pageMessages.useT();

  const { companyId } = useDefaultCompany();
  const { locale } = useTranslation();
  const { toast } = useToast();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBody, setPreviewBody] = useState("");
  const [previewLanguage, setPreviewLanguage] = useState<"en" | "ar">("en");
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkSendResponse | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────
  const overdueQuery = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${companyId}`),
    enabled: !!companyId,
  });

  const queueQuery = useQuery<QueueResponse>({
    queryKey: ["/api/chasing/queue", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/queue/${companyId}`),
    enabled: !!companyId,
  });

  const historyQuery = useQuery<ChaseRecord[]>({
    queryKey: ["/api/chasing/history", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/history/${companyId}?sinceDays=180`),
    enabled: !!companyId,
  });

  const effQuery = useQuery<Effectiveness>({
    queryKey: ["/api/chasing/effectiveness", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/effectiveness/${companyId}?sinceDays=180`),
    enabled: !!companyId,
  });

  const templatesQuery = useQuery<Template[]>({
    queryKey: ["/api/chasing/templates", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/templates/${companyId}`),
    enabled: !!companyId,
  });

  const configQuery = useQuery<ChaseConfig>({
    queryKey: ["/api/chasing/config", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/config/${companyId}`),
    enabled: !!companyId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────
  const sendOne = useMutation({
    mutationFn: (invoiceId: string) =>
      apiRequest("POST", `/api/chasing/send/${invoiceId}`, {
        method: "email",
        language: locale,
      }),
    onSuccess: (data: any) => {
      toast({
        title: tr("reminderReady"),
        description: tr("reviewTheMessageThenSendIt"),
      });
      setPreviewBody(data.message);
      // Use the language we requested — server may fall back to default but the
      // text we just got back is rendered in the requested locale's template.
      setPreviewLanguage(locale === "ar" ? "ar" : "en");
      setPreviewOpen(true);
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/overdue", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/history", companyId] });
    },
    onError: (e: any) =>
      toast({
        title: tr("couldNotSend"),
        description: e?.message ?? tr("unknownError"),
        variant: "destructive",
      }),
  });

  const bulkSend = useMutation<BulkSendResponse, Error, void>({
    mutationFn: () =>
      apiRequest("POST", `/api/chasing/bulk-send/${companyId}`, {
        method: "email",
        language: locale,
      }),
    onSuccess: (data) => {
      const failed = data.failed ?? 0;
      toast({
        title: failed > 0 ? tr("bulkSendCompletedWithErrors") : tr("bulkRemindersQueued"),
        description: tr("sentSkippedFailed", { sent: data.sent, skipped: data.skipped, failed }),
        variant: failed > 0 ? "destructive" : "default",
      });
      setBulkResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/overdue", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/history", companyId] });
    },
    onError: (e) =>
      toast({
        title: tr("bulkSendFailed"),
        description: e?.message ?? "—",
        variant: "destructive",
      }),
  });

  const toggleDoNotChase = useMutation({
    mutationFn: ({ invoiceId, value }: { invoiceId: string; value: boolean }) =>
      apiRequest("PATCH", `/api/chasing/invoice/${invoiceId}/do-not-chase`, { doNotChase: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/overdue", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
    },
  });

  const saveConfig = useMutation({
    mutationFn: (patch: Partial<ChaseConfig> & { doNotChaseContactIds?: string[] }) =>
      apiRequest("PATCH", `/api/chasing/config/${companyId}`, patch),
    onSuccess: () => {
      toast({ title: tr("settingsSaved") });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/config", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
    },
  });

  const saveTemplate = useMutation({
    mutationFn: (t: Template) => {
      // companyId-owned templates are PATCHable; system defaults (companyId=null) get cloned via POST.
      if (t.companyId === companyId) {
        return apiRequest("PATCH", `/api/chasing/templates/${companyId}/${t.id}`, {
          level: t.level,
          language: t.language,
          subject: t.subject,
          body: t.body,
        });
      }
      return apiRequest("POST", `/api/chasing/templates/${companyId}`, {
        level: t.level,
        language: t.language,
        subject: t.subject,
        body: t.body,
      });
    },
    onSuccess: () => {
      toast({ title: tr("templateSaved") });
      setEditingTemplate(null);
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/templates", companyId] });
    },
    onError: (e: any) =>
      toast({
        title: tr("couldNotSaveTemplate"),
        description: e?.message ?? tr("unknownError"),
        variant: "destructive",
      }),
  });

  // ── Per-invoice history ────────────────────────────────────────────────
  const invoiceHistoryQuery = useQuery<ChaseRecord[]>({
    queryKey: ["/api/chasing/invoice", historyInvoiceId, "history"],
    queryFn: () => apiRequest("GET", `/api/chasing/invoice/${historyInvoiceId}/history`),
    enabled: !!historyInvoiceId,
  });

  // ── Derived ────────────────────────────────────────────────────────────
  const overdue = overdueQuery.data?.rows ?? [];
  const buckets: Record<AgingBucket, number> = overdueQuery.data?.buckets ?? {
    "1-7": 0,
    "8-30": 0,
    "31-60": 0,
    "60+": 0,
  };
  const totalOutstanding = overdueQuery.data?.totalOutstanding ?? 0;
  const queue = queueQuery.data?.queue ?? [];

  const sortedOverdue = useMemo(
    () => [...overdue].sort((a, b) => b.daysOverdue - a.daysOverdue),
    [overdue]
  );

  // Pick a currency label for the Total Outstanding card. If every overdue row
  // is in the same currency, show that. Otherwise fall back to "Mixed" rather
  // than misleadingly tagging the sum with one of them.
  const totalOutstandingCurrency = useMemo(() => {
    const currencies = new Set(overdue.map((r) => r.invoice.currency));
    if (currencies.size === 0) return configQuery.data?.defaultLanguage === "ar" ? "AED" : "AED";
    if (currencies.size === 1) return [...currencies][0];
    return "Mixed";
  }, [overdue, configQuery.data?.defaultLanguage]);

  // Placeholder validation for the template editor: tokens not in the
  // RenderContext set will silently render as literal text in production.
  const editingPlaceholders = useMemo(() => {
    if (!editingTemplate) return { all: [] as string[], unknown: [] as string[] };
    const matches = Array.from(editingTemplate.body.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
    const all = Array.from(new Set(matches));
    const unknown = all.filter(
      (p) => !KNOWN_PLACEHOLDERS.includes(p as (typeof KNOWN_PLACEHOLDERS)[number])
    );
    return { all, unknown };
  }, [editingTemplate]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="payment-chasing-page">
      <PageHeader
        eyebrow={tr("sales")}
        title={tr("paymentChasingAutopilot")}
        description={tr("automatedRemindersForOverdueInvoicesWith")}
        actions={
          <Button
            onClick={() => {
              if (queue.length > BULK_CONFIRM_THRESHOLD) {
                setBulkConfirmOpen(true);
              } else {
                bulkSend.mutate();
              }
            }}
            disabled={queue.length === 0 || bulkSend.isPending}
            data-testid="button-chase-all"
          >
            <Send className="me-2 h-4 w-4" />
            {bulkSend.isPending
              ? tr("sending", { queueCount: queue.length })
              : tr("chaseAll", { queueCount: queue.length })}
          </Button>
        }
      />

      {/* Aging buckets */}
      <div className="grid gap-4 md:grid-cols-4">
        {(["1-7", "8-30", "31-60", "60+"] as AgingBucket[]).map((b) => (
          <Card key={b} className={bucketColor(b)} data-testid={`bucket-${b}`}>
            <CardHeader className="pb-2">
              <CardDescription>{tr("daysOverdue", { b })}</CardDescription>
              <CardTitle className="text-3xl">
                {overdueQuery.isLoading ? <Skeleton className="h-9 w-12" /> : (buckets[b] ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{tr("invoices")}</CardContent>
          </Card>
        ))}
      </div>

      {overdueQuery.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {tr("couldNotLoadOverdueInvoices")}
            {overdueQuery.error instanceof Error ? overdueQuery.error.message : tr("unknownError")}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr("totalOutstanding")}</CardTitle>
          <CardDescription>
            {overdueQuery.isLoading
              ? tr("loading")
              : tr.plural("overdueInvoicesCount", overdue.length)}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-3xl font-semibold" data-testid="total-outstanding">
          {overdueQuery.isLoading ? (
            <Skeleton className="h-9 w-48" />
          ) : (
            <>
              {formatCurrency(totalOutstanding, totalOutstandingCurrency)}
              {totalOutstandingCurrency === "Mixed" && (
                <p className="text-xs font-normal text-muted-foreground mt-1">
                  {tr("sumAcrossMultipleCurrenciesOpenThe")}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overdue" className="w-full">
        <TabsList>
          <TabsTrigger value="overdue">
            <AlertTriangle className="me-2 h-4 w-4" />
            {tr("overdue")}
          </TabsTrigger>
          <TabsTrigger value="queue">
            <Inbox className="me-2 h-4 w-4" />
            {tr("queue")}
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="me-2 h-4 w-4" />
            {tr("history")}
          </TabsTrigger>
          <TabsTrigger value="effectiveness">
            <BarChart3 className="me-2 h-4 w-4" />
            {tr("effectiveness")}
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileText className="me-2 h-4 w-4" />
            {tr("templates")}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <SettingsIcon className="me-2 h-4 w-4" />
            {tr("settings")}
          </TabsTrigger>
        </TabsList>

        {/* ── Overdue ─────────────────────────────────────────────────── */}
        <TabsContent value="overdue">
          <Card>
            <CardHeader>
              <CardTitle>{tr("overdueInvoices")}</CardTitle>
              <CardDescription>{tr("sortedByDaysOverdueOldestFirst")}</CardDescription>
            </CardHeader>
            <CardContent>
              {overdueQuery.isLoading && <Skeleton className="h-32" />}
              {!overdueQuery.isLoading && sortedOverdue.length === 0 && (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success" />
                  {tr("noOverdueInvoicesNice")}
                </div>
              )}
              {sortedOverdue.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("invoice")}</TableHead>
                      <TableHead>{tr("customer")}</TableHead>
                      <TableHead className="text-end">{tr("outstanding")}</TableHead>
                      <TableHead className="text-end">{tr("daysOverdue2")}</TableHead>
                      <TableHead>{tr("bucket")}</TableHead>
                      <TableHead>{tr("lastChase")}</TableHead>
                      <TableHead className="text-end">{tr("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOverdue.map((row) => (
                      <TableRow
                        key={row.invoice.id}
                        data-testid={`overdue-row-${row.invoice.number}`}
                      >
                        <TableCell className="font-mono">{row.invoice.number}</TableCell>
                        <TableCell>{row.invoice.customerName}</TableCell>
                        <TableCell className="text-end">
                          {formatCurrency(row.outstanding, row.invoice.currency)}
                        </TableCell>
                        <TableCell className="text-end">{row.daysOverdue}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.bucket}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.invoice.chaseLevel && row.invoice.chaseLevel > 0 ? (
                            <Badge className={levelColor(row.invoice.chaseLevel)}>
                              L{row.invoice.chaseLevel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setHistoryInvoiceId(row.invoice.id)}
                            data-testid={`button-history-${row.invoice.number}`}
                          >
                            <Clock className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant={row.invoice.doNotChase ? "destructive" : "ghost"}
                            onClick={() =>
                              toggleDoNotChase.mutate({
                                invoiceId: row.invoice.id,
                                value: !row.invoice.doNotChase,
                              })
                            }
                            data-testid={`button-dnc-${row.invoice.number}`}
                            title={row.invoice.doNotChase ? tr("resumeChasing") : tr("doNotChase")}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => sendOne.mutate(row.invoice.id)}
                            disabled={row.invoice.doNotChase || sendOne.isPending}
                            data-testid={`button-send-${row.invoice.number}`}
                          >
                            {tr("send")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Queue ──────────────────────────────────────────────────── */}
        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <CardTitle>{tr("nextChaseQueue")}</CardTitle>
              <CardDescription>
                {tr("invoicesEligibleForTheNextChase")}
                {queueQuery.data?.config.frequencyDays ?? 7} {tr("daysMaxLevel")}
                {queueQuery.data?.config.maxLevel ?? 4})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {queueQuery.isLoading && <Skeleton className="h-32" />}
              {queueQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {tr("couldNotLoadChaseQueue")}
                    {queueQuery.error instanceof Error
                      ? queueQuery.error.message
                      : tr("unknownError")}
                  </AlertDescription>
                </Alert>
              )}
              {!queueQuery.isLoading && !queueQuery.isError && queue.length === 0 ? (
                <div className="text-muted-foreground text-sm py-8 text-center">
                  {tr("nothingWaitingInTheQueue")}
                </div>
              ) : (
                !queueQuery.isLoading &&
                !queueQuery.isError && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("invoice")}</TableHead>
                        <TableHead>{tr("customer")}</TableHead>
                        <TableHead>{tr("nextLevel")}</TableHead>
                        <TableHead className="text-end">{tr("outstanding")}</TableHead>
                        <TableHead className="text-end">{tr("days")}</TableHead>
                        <TableHead className="text-end">{tr("action")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queue.map((row) => (
                        <TableRow
                          key={row.invoice.id}
                          data-testid={`queue-row-${row.invoice.number}`}
                        >
                          <TableCell className="font-mono">{row.invoice.number}</TableCell>
                          <TableCell>{row.invoice.customerName}</TableCell>
                          <TableCell>
                            {row.nextLevel ? (
                              <Badge className={levelColor(row.nextLevel)}>
                                L{row.nextLevel} — {levelLabel(row.nextLevel, locale)}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(row.outstanding, row.invoice.currency)}
                          </TableCell>
                          <TableCell className="text-end">{row.daysOverdue}</TableCell>
                          <TableCell className="text-end">
                            <Button size="sm" onClick={() => sendOne.mutate(row.invoice.id)}>
                              {tr("send")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History ────────────────────────────────────────────────── */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>{tr("chaseHistory")}</CardTitle>
              <CardDescription>{tr("last180Days")}</CardDescription>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading && <Skeleton className="h-32" />}
              {historyQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {tr("couldNotLoadHistory")}
                    {historyQuery.error instanceof Error
                      ? historyQuery.error.message
                      : tr("unknownError")}
                  </AlertDescription>
                </Alert>
              )}
              {!historyQuery.isLoading &&
                !historyQuery.isError &&
                historyQuery.data?.length === 0 && (
                  <div className="text-muted-foreground text-sm py-8 text-center">
                    {tr("noChaseHistoryYet")}
                  </div>
                )}
              {historyQuery.data && historyQuery.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("sent")}</TableHead>
                      <TableHead>{tr("level")}</TableHead>
                      <TableHead>{tr("method")}</TableHead>
                      <TableHead>{tr("lang")}</TableHead>
                      <TableHead>{tr("status")}</TableHead>
                      <TableHead className="text-end">{tr("daysOverdue2")}</TableHead>
                      <TableHead className="text-end">{tr("amount")}</TableHead>
                      <TableHead>{tr("paid")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyQuery.data.map((c) => (
                      <TableRow key={c.id} data-testid={`history-row-${c.id}`}>
                        <TableCell>{new Date(c.sentAt).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge className={levelColor(c.level)}>L{c.level}</Badge>
                        </TableCell>
                        <TableCell>{c.method}</TableCell>
                        <TableCell>{c.language}</TableCell>
                        <TableCell>
                          <Badge
                            variant={c.status === "failed" ? "destructive" : "outline"}
                            data-testid={`history-status-${c.id}`}
                          >
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end">{c.daysOverdueAtSend}</TableCell>
                        <TableCell className="text-end">
                          {Number(c.amountAtSend).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {c.paidAt ? (
                            <Badge className="bg-success-subtle text-success-subtle-foreground">
                              {tr("paid2", {
                                toLocaleDateString: new Date(c.paidAt).toLocaleDateString(),
                              })}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Effectiveness ──────────────────────────────────────────── */}
        <TabsContent value="effectiveness">
          {effQuery.isError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {tr("couldNotLoadEffectivenessMetrics")}
                {effQuery.error instanceof Error ? effQuery.error.message : tr("unknownError")}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <Card data-testid="metric-conversion-rate">
              <CardHeader>
                <CardDescription>{tr("conversionRate")}</CardDescription>
                <CardTitle className="text-3xl">
                  {effQuery.isLoading ? (
                    <Skeleton className="h-9 w-20" />
                  ) : (
                    `${((effQuery.data?.conversionRate ?? 0) * 100).toFixed(1)}%`
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {effQuery.isLoading ? (
                  <Skeleton className="h-3 w-32" />
                ) : (
                  tr("chasedInvoicesPaid", {
                    value: effQuery.data?.paidAfterChase ?? 0,
                    value2: effQuery.data?.uniqueInvoices ?? 0,
                  })
                )}
              </CardContent>
            </Card>
            <Card data-testid="metric-avg-days">
              <CardHeader>
                <CardDescription>{tr("avgDaysToPayment")}</CardDescription>
                <CardTitle className="text-3xl">
                  {effQuery.isLoading ? (
                    <Skeleton className="h-9 w-16" />
                  ) : (
                    (effQuery.data?.avgDaysToPayment ?? "—")
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {tr("afterFirstChase")}
              </CardContent>
            </Card>
            <Card data-testid="metric-windowed">
              <CardHeader>
                <CardDescription>{tr("paidWithinWindow")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>
                  {tr("n7Days")} <strong>{effQuery.data?.paidWithin7 ?? 0}</strong>
                </div>
                <div>
                  {tr("n14Days")} <strong>{effQuery.data?.paidWithin14 ?? 0}</strong>
                </div>
                <div>
                  {tr("n30Days")} <strong>{effQuery.data?.paidWithin30 ?? 0}</strong>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{tr("byEscalationLevel")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("level")}</TableHead>
                    <TableHead className="text-end">{tr("sent")}</TableHead>
                    <TableHead className="text-end">{tr("paid3")}</TableHead>
                    <TableHead className="text-end">{tr("rate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[1, 2, 3, 4].map((level) => {
                    const lv = effQuery.data?.byLevel?.[String(level)] ?? { sent: 0, paid: 0 };
                    const rate = lv.sent === 0 ? 0 : (lv.paid / lv.sent) * 100;
                    return (
                      <TableRow key={level}>
                        <TableCell>
                          <Badge className={levelColor(level)}>
                            L{level} — {levelLabel(level, locale)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end">{lv.sent}</TableCell>
                        <TableCell className="text-end">{lv.paid}</TableCell>
                        <TableCell className="text-end">{rate.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Templates ──────────────────────────────────────────────── */}
        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle>{tr("messageTemplates")}</CardTitle>
              <CardDescription>
                {tr("customizeEachEscalationLevelPlaceholders")}
                <code className="ms-2 text-xs">
                  {
                    "{customerName} {invoiceNumber} {amount} {currency} {dueDate} {daysOverdue} {paymentLink} {senderName}"
                  }
                </code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {templatesQuery.isLoading && <Skeleton className="h-32" />}
              {templatesQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {tr("couldNotLoadTemplates")}
                    {templatesQuery.error instanceof Error
                      ? templatesQuery.error.message
                      : tr("unknownError")}
                  </AlertDescription>
                </Alert>
              )}
              {!templatesQuery.isLoading &&
                !templatesQuery.isError &&
                (templatesQuery.data?.length ?? 0) === 0 && (
                  <div className="text-muted-foreground text-sm py-8 text-center">
                    {tr("noTemplatesAvailableDefaultsWillBe")}
                  </div>
                )}
              {!templatesQuery.isLoading &&
                !templatesQuery.isError &&
                (templatesQuery.data?.length ?? 0) > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("level")}</TableHead>
                        <TableHead>{tr("language")}</TableHead>
                        <TableHead>{tr("source")}</TableHead>
                        <TableHead>{tr("subject")}</TableHead>
                        <TableHead className="text-end">{tr("edit")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templatesQuery.data?.map((t) => (
                        <TableRow key={t.id} data-testid={`template-row-${t.level}-${t.language}`}>
                          <TableCell>
                            <Badge className={levelColor(t.level)}>L{t.level}</Badge>
                          </TableCell>
                          <TableCell>{t.language}</TableCell>
                          <TableCell>{t.companyId ? tr("custom") : tr("default")}</TableCell>
                          <TableCell className="max-w-xs truncate">{t.subject ?? "—"}</TableCell>
                          <TableCell className="text-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingTemplate(t)}
                            >
                              {tr("edit")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Settings ───────────────────────────────────────────────── */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>{tr("chaseConfiguration")}</CardTitle>
              <CardDescription>{tr("controlsHowAggressivelyTheAutopilotChases")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {configQuery.isLoading && <Skeleton className="h-32" />}
              {configQuery.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {tr("couldNotLoadSettings")}
                    {configQuery.error instanceof Error
                      ? configQuery.error.message
                      : tr("unknownError")}
                  </AlertDescription>
                </Alert>
              )}
              {!configQuery.isLoading && !configQuery.isError && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>{tr("autoChaseEnabled")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {tr("automaticallyQueueChasesAsInvoicesAge")}
                      </p>
                    </div>
                    <Switch
                      checked={configQuery.data?.autoChaseEnabled ?? false}
                      onCheckedChange={(v) => saveConfig.mutate({ autoChaseEnabled: v })}
                      data-testid="switch-auto-chase"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <Label>{tr("chaseFrequencyDays")}</Label>
                      <Input
                        key={`freq-${configQuery.data?.chaseFrequencyDays ?? 7}`}
                        type="number"
                        min={1}
                        max={365}
                        defaultValue={configQuery.data?.chaseFrequencyDays ?? 7}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          // Server schema enforces 1..365; validate client-side too
                          // so the user gets immediate feedback rather than a 400.
                          if (!Number.isFinite(n) || n < 1 || n > 365) {
                            toast({
                              title: tr("invalidFrequency"),
                              description: tr("pickAValueBetween1And"),
                              variant: "destructive",
                            });
                            e.target.value = String(configQuery.data?.chaseFrequencyDays ?? 7);
                            return;
                          }
                          saveConfig.mutate({ chaseFrequencyDays: n });
                        }}
                        data-testid="input-frequency"
                      />
                    </div>
                    <div>
                      <Label>{tr("maxEscalationLevel")}</Label>
                      <Select
                        value={String(configQuery.data?.maxLevel ?? 4)}
                        onValueChange={(v) => saveConfig.mutate({ maxLevel: Number(v) })}
                      >
                        <SelectTrigger data-testid="select-max-level">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((l) => (
                            <SelectItem key={l} value={String(l)}>
                              L{l} — {levelLabel(l, locale)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tr("defaultLanguage")}</Label>
                      <Select
                        value={configQuery.data?.defaultLanguage ?? "en"}
                        onValueChange={(v) => saveConfig.mutate({ defaultLanguage: v })}
                      >
                        <SelectTrigger data-testid="select-language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en">{tr("english")}</SelectItem>
                          <SelectItem value="ar">العربية</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Preview dialog ──────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("reminderReady")}</DialogTitle>
            <DialogDescription>{tr("reviewTheMessageThenSendIt")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={previewBody}
            readOnly
            dir={previewLanguage === "ar" ? "rtl" : "ltr"}
            className="min-h-[260px] font-mono text-sm"
            data-testid="textarea-preview"
          />
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {tr("deliveryIsNotAutomaticFromThis")}
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="button-copy-preview"
              onClick={async () => {
                try {
                  if (!navigator.clipboard?.writeText) {
                    throw new Error("Clipboard API unavailable");
                  }
                  await navigator.clipboard.writeText(previewBody);
                  toast({ title: tr("copiedToClipboard") });
                } catch (err) {
                  toast({
                    title: tr("couldNotCopy"),
                    description:
                      err instanceof Error ? err.message : tr("selectTheTextAndCopyManually"),
                    variant: "destructive",
                  });
                }
              }}
            >
              {tr("copy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Per-invoice history dialog ──────────────────────────────── */}
      <Dialog open={!!historyInvoiceId} onOpenChange={(open) => !open && setHistoryInvoiceId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tr("invoiceChaseTimeline")}</DialogTitle>
          </DialogHeader>
          {invoiceHistoryQuery.isLoading && <Skeleton className="h-32" />}
          {invoiceHistoryQuery.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {tr("couldNotLoadTimeline")}
                {invoiceHistoryQuery.error instanceof Error
                  ? invoiceHistoryQuery.error.message
                  : tr("unknownError")}
              </AlertDescription>
            </Alert>
          )}
          {invoiceHistoryQuery.data && invoiceHistoryQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">{tr("noChasesYetForThisInvoice")}</p>
          )}
          <div className="space-y-3">
            {invoiceHistoryQuery.data?.map((c) => (
              <div
                key={c.id}
                className="border-s-2 border-muted ps-4 py-2"
                data-testid={`timeline-entry-${c.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={levelColor(c.level)}>L{c.level}</Badge>
                  <span className="text-sm font-medium">{new Date(c.sentAt).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">
                    {tr("via", { method: c.method, language: c.language })}
                  </span>
                  <Badge
                    variant={c.status === "failed" ? "destructive" : "outline"}
                    className="text-xs"
                  >
                    {c.status}
                  </Badge>
                </div>
                <pre
                  className="mt-2 text-xs whitespace-pre-wrap font-sans"
                  dir={c.language === "ar" ? "rtl" : "ltr"}
                >
                  {c.messageText}
                </pre>
                {c.paidAt && (
                  <Badge className="mt-2 bg-success-subtle text-success-subtle-foreground">
                    {tr("paid2", { toLocaleDateString: new Date(c.paidAt).toLocaleDateString() })}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Template editor dialog ─────────────────────────────────── */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {tr("editTemplateL", { level: editingTemplate?.level })}
              {editingTemplate?.language === "ar" ? tr("arabic") : tr("english2")}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate?.companyId
                ? tr("customTemplateSavingUpdatesThisTemplate")
                : tr("systemDefaultSavingCreatesACompany")}
            </DialogDescription>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-4">
              <div>
                <Label>{tr("subjectUsedForEmail")}</Label>
                <Input
                  value={editingTemplate.subject ?? ""}
                  onChange={(e) =>
                    setEditingTemplate({ ...editingTemplate, subject: e.target.value })
                  }
                  dir={editingTemplate.language === "ar" ? "rtl" : "ltr"}
                  data-testid="input-template-subject"
                />
              </div>
              <div>
                <Label>{tr("body")}</Label>
                <Textarea
                  value={editingTemplate.body}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                  className="min-h-[260px] font-mono text-sm"
                  dir={editingTemplate.language === "ar" ? "rtl" : "ltr"}
                  data-testid="textarea-template-body"
                />
                {editingPlaceholders.unknown.length > 0 && (
                  <Alert
                    variant="destructive"
                    className="mt-2"
                    data-testid="alert-unknown-placeholders"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {tr.plural("unknownPlaceholder", editingPlaceholders.unknown.length)}{" "}
                      <code>{editingPlaceholders.unknown.map((p) => `{${p}}`).join(", ")}</code> —{" "}
                      {tr("willRenderAsLiteralTextKnownPlaceholders")}{" "}
                      <code>{KNOWN_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}</code>.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() => editingTemplate && saveTemplate.mutate(editingTemplate)}
              disabled={saveTemplate.isPending || !editingTemplate?.body?.trim()}
              data-testid="button-save-template"
            >
              {saveTemplate.isPending ? tr("saving") : tr("saveTemplate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk-send confirmation ──────────────────────────────────── */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent data-testid="alert-bulk-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("sendChaseReminders", { queueCount: queue.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>{tr("thisWillRecordAChaseAgainst")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-bulk"
              onClick={() => {
                setBulkConfirmOpen(false);
                bulkSend.mutate();
              }}
            >
              {tr("sendAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bulk-send results ───────────────────────────────────────── */}
      <Dialog open={!!bulkResults} onOpenChange={(open) => !open && setBulkResults(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tr("bulkChaseResults")}</DialogTitle>
            <DialogDescription>
              {bulkResults && (
                <>
                  {tr("sent")} <strong className="text-foreground">{bulkResults.sent}</strong>
                  {" • "}
                  {tr("skipped")} <strong className="text-foreground">{bulkResults.skipped}</strong>
                  {" • "}
                  {tr("failed")}
                  <strong
                    className={bulkResults.failed > 0 ? "text-destructive" : "text-foreground"}
                  >
                    {bulkResults.failed}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {bulkResults && bulkResults.results.length > 0 && (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("invoice")}</TableHead>
                    <TableHead>{tr("level")}</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead>{tr("detail")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkResults.results.map((r) => {
                    // Match invoice number from the queue snapshot at time of send.
                    const matchedInvoice =
                      queue.find((q) => q.invoice.id === r.invoiceId) ??
                      overdue.find((o) => o.invoice.id === r.invoiceId);
                    const number = matchedInvoice?.invoice.number ?? r.invoiceId.slice(0, 8);
                    return (
                      <TableRow key={r.invoiceId} data-testid={`bulk-result-${r.invoiceId}`}>
                        <TableCell className="font-mono text-xs">{number}</TableCell>
                        <TableCell>
                          {r.level > 0 ? (
                            <Badge className={levelColor(r.level)}>L{r.level}</Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "sent"
                                ? "default"
                                : r.status === "failed"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.error ? (
                            <span className="text-destructive">{r.error}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkResults(null)}>
              {tr("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
