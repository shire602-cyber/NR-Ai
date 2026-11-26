import { T } from "@/components/layout/T";
import { DatePicker } from "@/components/ui/date-picker";
import { StatCard } from "@/components/ui/stat-card";
import { useTranslation, formatMessage, translateNow } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import { localizeServerText } from "@shared/server-copy";
import { formatDate, formatEmbeddedDates, parseCalendarDate } from "@/lib/format-date";
import { CheckCircle2, Plus, Send } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { hasReadData, queryReadState } from "@/lib/queryReadState";
import { DOCUMENT_TYPES, COMPLIANCE_EVENT_TYPES } from "@shared/schema-values";

// ── Types echoed from server response shape ───────────────────────────
interface Requirement {
  id: string;
  companyId: string;
  documentType: string;
  description: string | null;
  dueDate: string;
  isRecurring: boolean;
  recurringIntervalDays: number | null;
  status: string;
  receivedAt: string | null;
  notes: string | null;
}

interface ChaseQueueItem {
  requirement: Requirement;
  nextLevel: "friendly" | "follow_up" | "urgent" | "final";
  message: string;
  whatsappLink: string | null;
  daysOverdue: number;
}

interface ComplianceEvent {
  id: string;
  eventType: string;
  title?: string;
  titleAr?: string | null;
  description: string;
  eventDate: string;
  reminderDays: string;
  status: string;
}

interface Effectiveness {
  totalChased: number;
  totalReceived: number;
  responseRate: number;
  avgDaysToUpload: number | null;
}

/** Catalog label of a document type, calendar event type or chase level (the API sends the id). */
function enumLabel(
  t: Record<string, string>,
  kind: "docType" | "eventType" | "chaseLevel",
  value: string
): string {
  return t[`firmOps.${kind}_${value}`] ?? value.replace(/_/g, " ");
}

function levelBadgeColor(level: string) {
  switch (level) {
    case "friendly":
      return "bg-info-subtle text-info-subtle-foreground ";
    case "follow_up":
      return "bg-warning-subtle text-warning-subtle-foreground ";
    case "urgent":
      return "bg-warning-subtle text-warning-subtle-foreground ";
    case "final":
      return "bg-danger-subtle text-danger-subtle-foreground ";
    default:
      return "bg-muted text-foreground";
  }
}

export default function DocumentChasing() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: companyLoading } = useDefaultCompany();
  const [showAddRequirement, setShowAddRequirement] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [previewItem, setPreviewItem] = useState<ChaseQueueItem | null>(null);

  const requirementsQuery = useQuery<Requirement[]>({
    queryKey: ["/api/companies", companyId, "document-requirements"],
    enabled: !!companyId,
  });

  const queueQuery = useQuery<ChaseQueueItem[]>({
    queryKey: ["/api/companies", companyId, "document-chases", "queue"],
    enabled: !!companyId,
  });

  const eventsQuery = useQuery<ComplianceEvent[]>({
    queryKey: ["/api/companies", companyId, "compliance-calendar"],
    enabled: !!companyId,
  });

  const effectivenessQuery = useQuery<Effectiveness>({
    queryKey: ["/api/companies", companyId, "document-chases", "effectiveness"],
    enabled: !!companyId,
  });

  const sendChaseMutation = useMutation({
    mutationFn: (input: { requirementId: string; overrideMessage?: string; channel?: string }) =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/document-chases/send/${input.requirementId}`,
        {
          overrideMessage: input.overrideMessage,
          channel: input.channel ?? "whatsapp",
        }
      ),
    onSuccess: (data: { whatsappLink?: string | null }) => {
      toast({
        title: translateNow("toasts.chaseRecorded"),
        description: translateNow("toasts.markedAsSent"),
      });
      if (data?.whatsappLink) window.open(data.whatsappLink, "_blank", "noopener,noreferrer");
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "queue"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "effectiveness"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-requirements"],
      });
      setPreviewItem(null);
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.failed"),
        description: e.message ?? translateNow("toasts.sendFailed"),
        variant: "destructive",
      }),
  });

  const bulkSendMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/document-chases/bulk-send`, {}),
    onSuccess: (data: { sentCount: number }) => {
      toast({
        title: translateNow("toasts.bulkChaseComplete"),
        description: formatMessage(translateNow("toasts.sentReminders"), {
          sentCount: data.sentCount,
        }),
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "queue"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "effectiveness"],
      });
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.failed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const markReceivedMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/companies/${companyId}/document-requirements/${id}`, {
        status: "received",
      }),
    onSuccess: () => {
      toast({ title: t["documentChasing.markedReceived"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-requirements"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "queue"],
      });
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.failed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const requirementsState = queryReadState(requirementsQuery);
  const queueState = queryReadState(queueQuery);
  const requirements = useMemo(
    () => (hasReadData(requirementsState) ? (requirementsQuery.data ?? []) : []),
    [requirementsState, requirementsQuery.data]
  );
  const queue = hasReadData(queueState) ? (queueQuery.data ?? []) : [];
  const events = eventsQuery.data ?? [];

  const missingDocs = useMemo(
    () => requirements.filter((r) => r.status !== "received" && r.status !== "waived"),
    [requirements]
  );

  const stats = useMemo(() => {
    const overdue = missingDocs.filter(
      (r) => differenceInDays(new Date(), parseCalendarDate(r.dueDate)) > 0
    ).length;
    const dueSoon = missingDocs.filter((r) => {
      const d = differenceInDays(parseCalendarDate(r.dueDate), new Date());
      return d >= 0 && d <= 14;
    }).length;
    return { overdue, dueSoon, total: missingDocs.length };
  }, [missingDocs]);

  if (companyLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-64 mb-6" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6 text-muted-foreground" data-testid="document-chasing-no-company">
        <T k="pages.noCompanySelected" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-document-chasing">
      <PageHeader
        eyebrow="Compliance"
        title={t["documentChasing.documentChasingAutopilot"]}
        description={t["documentChasing.trackMissingUaeComplianceDocuments"]}
        actions={
          // Spec 3.17: no "Send all (0)" — the action only exists when something is queued.
          queue.length === 0 ? undefined : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="default"
                  disabled={bulkSendMutation.isPending}
                  data-testid="btn-bulk-send"
                >
                  <Send className="w-4 h-4 me-2" />
                  {formatMessage(t["documentChasing.sendAllCount"], { count: queue.length })}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {formatMessage(t["firmOps.bulkSendTitle"], { count: queue.length })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t["firmOps.bulkSendBody"]}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    <T k="pages.cancel" />
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={() => bulkSendMutation.mutate()}>
                    <T k="pages.sendAll" />
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )
        }
      />

      {/* Top stats. Fable P-g: hidden until something is missing or has been chased, so an
          empty workspace does not open on four zero tiles. */}
      {hasReadData(requirementsState) &&
        (stats.total > 0 || (effectivenessQuery.data?.totalChased ?? 0) > 0) && (
          <div
            className="grid grid-cols-1 md:grid-cols-4 gap-4"
            data-testid="document-chasing-stats"
          >
            <StatCard label={t["pages.missingDocuments"]} value={stats.total} />
            <StatCard label={t["components.statusOverdue"]} value={stats.overdue} />
            <StatCard label={t["documentChasing.dueIn14Days"]} value={stats.dueSoon} />
            <StatCard
              label={t["documentChasing.responseRate2"]}
              value={
                effectivenessQuery.data
                  ? `${Math.round(effectivenessQuery.data.responseRate * 100)}%`
                  : "—"
              }
            />
          </div>
        )}

      <Tabs defaultValue="missing" className="w-full">
        <TabsList>
          <TabsTrigger value="missing">
            <T k="pages.missing" />
          </TabsTrigger>
          <TabsTrigger value="queue">
            {hasReadData(queueState) ? (
              formatMessage(t["documentChasing.chaseQueueCount"], { count: queue.length })
            ) : (
              <T k="pages.chaseQueue" />
            )}
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <T k="pages.complianceCalendar" />
          </TabsTrigger>
          <TabsTrigger value="metrics">
            <T k="pages.effectiveness" />
          </TabsTrigger>
        </TabsList>

        {/* Missing documents */}
        <TabsContent value="missing">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>
                  <T k="pages.missingDocuments" />
                </CardTitle>
                <CardDescription>
                  <T k="pages.whatThisClientStillOwesYou" />
                </CardDescription>
              </div>
              <Button onClick={() => setShowAddRequirement(true)} data-testid="btn-add-requirement">
                <Plus className="w-4 h-4 me-2" /> <T k="pages.addRequirement" />
              </Button>
            </CardHeader>
            <CardContent>
              {requirementsState === "stale" && (
                <StaleDataNotice
                  onRetry={() => void requirementsQuery.refetch()}
                  testId="requirements-stale"
                />
              )}
              {requirementsState === "pending" ? (
                <Skeleton className="h-24 w-full" data-testid="requirements-loading" />
              ) : requirementsState === "error" ? (
                <LoadErrorState
                  compact
                  error={requirementsQuery.error}
                  onRetry={() => void requirementsQuery.refetch()}
                  testId="requirements-error"
                />
              ) : missingDocs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  {t["documentChasing.nothingMissingAllCaughtUp"]}
                </div>
              ) : (
                <div className="divide-y">
                  {missingDocs.map((r) => {
                    const due = parseCalendarDate(r.dueDate);
                    const daysFromDue = differenceInDays(new Date(), due);
                    const isOverdue = daysFromDue > 0;
                    return (
                      <div
                        key={r.id}
                        className="py-3 flex items-center gap-4 flex-wrap"
                        data-testid="row-missing-doc"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">
                            {enumLabel(t, "docType", r.documentType)}
                          </div>
                          {r.description && (
                            <div className="text-sm text-muted-foreground line-clamp-1">
                              {r.description}
                            </div>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatMessage(t["firmOps.chaseDue"], { date: formatDate(due, locale) })}
                        </div>
                        {isOverdue ? (
                          <Badge variant="destructive">
                            {formatMessage(t["firmOps.chaseDaysOverdue"], { n: daysFromDue })}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            {formatMessage(t["firmOps.chaseInDays"], { n: Math.abs(daysFromDue) })}
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => markReceivedMutation.mutate(r.id)}
                          data-testid="btn-mark-received"
                        >
                          <CheckCircle2 className="w-4 h-4 me-1" /> <T k="pages.received" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chase queue */}
        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <CardTitle>
                <T k="pages.chaseQueue" />
              </CardTitle>
              <CardDescription>{t["documentChasing.autoBuiltFromDueDates"]}</CardDescription>
            </CardHeader>
            <CardContent>
              {queueState === "stale" && (
                <div className="mb-3">
                  <StaleDataNotice onRetry={() => void queueQuery.refetch()} testId="queue-stale" />
                </div>
              )}
              {queueState === "pending" ? (
                <Skeleton className="h-24 w-full" data-testid="queue-loading" />
              ) : queueState === "error" ? (
                <LoadErrorState
                  compact
                  error={queueQuery.error}
                  onRetry={() => void queueQuery.refetch()}
                  testId="queue-error"
                />
              ) : queue.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  <T k="pages.noPendingChasesRightNow" />
                </div>
              ) : (
                <div className="space-y-3">
                  {queue.map((item) => (
                    <div
                      key={item.requirement.id}
                      className="border rounded-lg p-4 flex items-center gap-4 flex-wrap"
                      data-testid="row-queue-item"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">
                          {enumLabel(t, "docType", item.requirement.documentType)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatMessage(t["firmOps.chaseDue"], {
                            date: formatDate(item.requirement.dueDate, locale),
                          })}{" "}
                          ·{" "}
                          {item.daysOverdue > 0
                            ? formatMessage(t["firmOps.chaseDaysOverdue"], { n: item.daysOverdue })
                            : t["firmOps.chaseDueNow"]}
                        </div>
                      </div>
                      <Badge className={levelBadgeColor(item.nextLevel)}>
                        {enumLabel(t, "chaseLevel", item.nextLevel)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewItem(item)}
                        data-testid="btn-preview-chase"
                      >
                        <T k="pages.preview" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          sendChaseMutation.mutate({
                            requirementId: item.requirement.id,
                            channel: "whatsapp",
                          })
                        }
                        disabled={sendChaseMutation.isPending}
                        data-testid="btn-send-chase"
                      >
                        <SiWhatsapp className="w-4 h-4 me-2" /> {t["firmOps.chasingSend"]}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance calendar */}
        <TabsContent value="calendar">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>
                  <T k="pages.complianceCalendar2" />
                </CardTitle>
                <CardDescription>{t["firmOps.chaseCalendarDescription"]}</CardDescription>
              </div>
              <Button onClick={() => setShowAddEvent(true)} data-testid="btn-add-event">
                <Plus className="w-4 h-4 me-2" /> <T k="pages.addDeadline" />
              </Button>
            </CardHeader>
            <CardContent>
              {eventsQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : events.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  <T k="pages.noDeadlinesTrackedYet" />
                </div>
              ) : (
                <div className="divide-y">
                  {events.map((e) => {
                    const ed = parseCalendarDate(e.eventDate);
                    const dUntil = differenceInDays(ed, new Date());
                    return (
                      <div
                        key={e.id}
                        className="py-3 flex items-center gap-4 flex-wrap"
                        data-testid="row-event"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">
                            {enumLabel(t, "eventType", e.eventType)}
                          </div>
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {/* P-g: generated deadlines carry ISO dates in their text. */}
                            {formatEmbeddedDates(
                              locale === "ar" && e.titleAr
                                ? e.titleAr
                                : localizeServerText(e.description, t),
                              locale
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(ed, locale)}
                        </div>
                        {dUntil < 0 ? (
                          <Badge variant="destructive">
                            {formatMessage(t["firmOps.chaseDaysOverdue"], { n: Math.abs(dUntil) })}
                          </Badge>
                        ) : dUntil <= 30 ? (
                          <Badge className="bg-warning-subtle text-warning-subtle-foreground">
                            {formatMessage(t["firmOps.chaseInDays"], { n: dUntil })}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            {formatMessage(t["firmOps.chaseInDays"], { n: dUntil })}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Effectiveness */}
        <TabsContent value="metrics">
          <Card>
            <CardHeader>
              <CardTitle>
                <T k="pages.effectiveness" />
              </CardTitle>
              <CardDescription>
                <T k="pages.howWellIsTheChasePipelinePerforming" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {effectivenessQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Metric
                    label={t["documentChasing.totalChased"]}
                    value={effectivenessQuery.data?.totalChased ?? 0}
                  />
                  <Metric
                    label={t["documentChasing.totalReceived"]}
                    value={effectivenessQuery.data?.totalReceived ?? 0}
                  />
                  <Metric
                    label={t["documentChasing.responseRate2"]}
                    value={
                      effectivenessQuery.data
                        ? `${Math.round(effectivenessQuery.data.responseRate * 100)}%`
                        : "—"
                    }
                  />
                  <Metric
                    label={t["documentChasing.avgTimeToUpload"]}
                    value={
                      effectivenessQuery.data?.avgDaysToUpload != null
                        ? `${effectivenessQuery.data.avgDaysToUpload.toFixed(1)} days`
                        : "—"
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview dialog */}
      <Dialog open={!!previewItem} onOpenChange={(o) => !o && setPreviewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <T k="pages.previewChaseMessage" />
            </DialogTitle>
            <DialogDescription>{t["documentChasing.editTheMessageIfYou"]}</DialogDescription>
          </DialogHeader>
          {previewItem && (
            <PreviewBody
              item={previewItem}
              onCancel={() => setPreviewItem(null)}
              onSend={(msg) =>
                sendChaseMutation.mutate({
                  requirementId: previewItem.requirement.id,
                  overrideMessage: msg,
                })
              }
              sending={sendChaseMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Add requirement dialog */}
      <AddRequirementDialog
        open={showAddRequirement}
        onClose={() => setShowAddRequirement(false)}
        companyId={companyId}
      />

      {/* Add compliance event dialog */}
      <AddComplianceEventDialog
        open={showAddEvent}
        onClose={() => setShowAddEvent(false)}
        companyId={companyId}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border rounded-md p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function PreviewBody(props: {
  item: ChaseQueueItem;
  onCancel: () => void;
  onSend: (msg: string) => void;
  sending: boolean;
}) {
  const { t, locale } = useTranslation();
  const [draft, setDraft] = useState(props.item.message);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge className={levelBadgeColor(props.item.nextLevel)}>
          {enumLabel(t, "chaseLevel", props.item.nextLevel)}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {formatMessage(t["firmOps.chaseDueLine"], {
            doc: enumLabel(t, "docType", props.item.requirement.documentType),
            date: formatDate(props.item.requirement.dueDate, locale),
          })}
        </span>
      </div>
      <Label>
        <T k="pages.message" />
      </Label>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} />
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel}>
          <T k="pages.cancel" />
        </Button>
        <Button onClick={() => props.onSend(draft)} disabled={props.sending}>
          <SiWhatsapp className="w-4 h-4 me-2" /> <T k="pages.sendViaWhatsapp" />
        </Button>
      </DialogFooter>
    </div>
  );
}

function AddRequirementDialog(props: { open: boolean; onClose: () => void; companyId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState({
    documentType: "trade_license",
    description: "",
    dueDate: format(new Date(), "yyyy-MM-dd"),
    isRecurring: false,
    recurringIntervalDays: 365,
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/companies/${props.companyId}/document-requirements`, {
        documentType: data.documentType,
        description: data.description || null,
        dueDate: data.dueDate,
        isRecurring: data.isRecurring,
        recurringIntervalDays: data.isRecurring ? data.recurringIntervalDays : null,
      }),
    onSuccess: () => {
      toast({ title: t["documentChasing.requirementAdded"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", props.companyId, "document-requirements"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", props.companyId, "document-chases", "queue"],
      });
      props.onClose();
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.failed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <T k="pages.newDocumentRequirement" />
          </DialogTitle>
          <DialogDescription>
            <T k="pages.whatDoesThisClientOweYou" />
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="docType">
              <T k="pages.documentType" />
            </Label>
            <Select
              value={form.documentType}
              onValueChange={(v) => setForm((f) => ({ ...f, documentType: v }))}
            >
              <SelectTrigger id="docType" data-testid="select-doctype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {enumLabel(t, "docType", type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="docDescription">{t["firmOps.docDescriptionOptional"]}</Label>
            <Input
              id="docDescription"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t["documentChasing.q12026BankStatement"]}
            />
          </div>
          <div>
            <Label htmlFor="docDueDate">
              <T k="pages.dueDate2" />
            </Label>
            <DatePicker
              id="docDueDate"
              value={form.dueDate}
              onChange={(v) => setForm((f) => ({ ...f, dueDate: v }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isRecurring"
              checked={form.isRecurring}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, isRecurring: checked === true }))
              }
            />
            <Label htmlFor="isRecurring" className="cursor-pointer">
              <T k="pages.recurring" />
            </Label>
            {form.isRecurring && (
              <>
                <Input
                  type="number"
                  min={1}
                  value={form.recurringIntervalDays}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      recurringIntervalDays: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-32"
                  aria-label={t["documentChasing.recurringIntervalInDays"]}
                />
                <span className="text-sm text-muted-foreground">days</span>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            <T k="pages.cancel" />
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.dueDate}
          >
            {t["firmOps.add"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddComplianceEventDialog(props: {
  open: boolean;
  onClose: () => void;
  companyId: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState({
    eventType: "trade_license_renewal",
    description: "",
    eventDate: format(new Date(), "yyyy-MM-dd"),
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiRequest("POST", `/api/companies/${props.companyId}/compliance-calendar`, {
        eventType: data.eventType,
        description: data.description,
        eventDate: data.eventDate,
        reminderDays: [30, 14, 7, 0],
      }),
    onSuccess: () => {
      toast({ title: t["documentChasing.deadlineAdded"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", props.companyId, "compliance-calendar"],
      });
      props.onClose();
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.failed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <T k="pages.newComplianceDeadline" />
          </DialogTitle>
          <DialogDescription>
            <T k="pages.uaeComplianceEventToTrackAndRemindOn" />
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="eventType">
              <T k="pages.eventType" />
            </Label>
            <Select
              value={form.eventType}
              onValueChange={(v) => setForm((f) => ({ ...f, eventType: v }))}
            >
              <SelectTrigger id="eventType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLIANCE_EVENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {enumLabel(t, "eventType", type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="eventDescription">
              <T k="pages.description" />
            </Label>
            <Input
              id="eventDescription"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t["documentChasing.tradeLicenceRenewalAtDubai"]}
            />
          </div>
          <div>
            <Label htmlFor="eventDate">{t["firmOps.date"]}</Label>
            <DatePicker
              id="eventDate"
              value={form.eventDate}
              onChange={(v) => setForm((f) => ({ ...f, eventDate: v }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            <T k="pages.cancel" />
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.description.trim() || !form.eventDate}
          >
            {t["firmOps.add"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
