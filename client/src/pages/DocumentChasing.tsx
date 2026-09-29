import { PageHeader } from "@/components/ui/page-header";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO, differenceInDays } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileText,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
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
import { DOCUMENT_TYPES, COMPLIANCE_EVENT_TYPES } from "@shared/schema";
import { messages as pageMessages } from "./DocumentChasing.i18n";

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

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  const tr = pageMessages.useT();

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
      toast({ title: tr("chaseRecorded"), description: tr("markedAsSent") });
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
        title: tr("failed"),
        description: e.message ?? tr("sendFailed"),
        variant: "destructive",
      }),
  });

  const bulkSendMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/document-chases/bulk-send`, {}),
    onSuccess: (data: { sentCount: number }) => {
      toast({
        title: tr("bulkChaseComplete"),
        description: tr("sentReminders", { sentCount: data.sentCount }),
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "queue"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "effectiveness"],
      });
    },
    onError: (e: Error) =>
      toast({ title: tr("failed"), description: e.message, variant: "destructive" }),
  });

  const markReceivedMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/companies/${companyId}/document-requirements/${id}`, {
        status: "received",
      }),
    onSuccess: () => {
      toast({ title: tr("markedReceived") });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-requirements"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "document-chases", "queue"],
      });
    },
    onError: (e: Error) =>
      toast({ title: tr("failed"), description: e.message, variant: "destructive" }),
  });

  const requirements = requirementsQuery.data ?? [];
  const queue = queueQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  const missingDocs = useMemo(
    () => requirements.filter((r) => r.status !== "received" && r.status !== "waived"),
    [requirements]
  );

  const stats = useMemo(() => {
    const overdue = missingDocs.filter(
      (r) => differenceInDays(new Date(), parseISO(r.dueDate)) > 0
    ).length;
    const dueSoon = missingDocs.filter((r) => {
      const d = differenceInDays(parseISO(r.dueDate), new Date());
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
        {tr("noCompanySelected")}
      </div>
    );
  }

  if (requirementsQuery.isError || queueQuery.isError) {
    const err = requirementsQuery.error ?? queueQuery.error;
    return (
      <div
        role="alert"
        className="m-6 rounded-md border border-destructive/30 bg-danger-subtle p-6 text-sm"
        data-testid="document-chasing-error"
      >
        <div className="font-medium mb-1">{tr("failedToLoadDocumentChasingData")}</div>
        <div className="text-muted-foreground">
          {err instanceof Error ? err.message : tr("anUnexpectedErrorOccurred")}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            requirementsQuery.refetch();
            queueQuery.refetch();
          }}
        >
          {tr("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-document-chasing">
      <PageHeader
        eyebrow={tr("compliance")}
        title={tr("documentChasingAutopilot")}
        description={tr("trackMissingUaeComplianceDocumentsEscalate")}
        actions={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="default"
                disabled={queue.length === 0 || bulkSendMutation.isPending}
                data-testid="btn-bulk-send"
              >
                <Send className="w-4 h-4 me-2" />
                {tr("sendAll", { queueCount: queue.length })}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr.plural("sendChaseReminders", queue.length)}</AlertDialogTitle>
                <AlertDialogDescription>{tr("thisWillRecordAChaseEvent")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => bulkSendMutation.mutate()}>
                  {tr("sendAll2")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />

      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title={tr("missingDocuments")}
          value={stats.total}
          icon={<FileText className="w-5 h-5 text-info" />}
        />
        <StatCard
          title={tr("overdue")}
          value={stats.overdue}
          icon={<AlertTriangle className="w-5 h-5 text-destructive" />}
          tone={stats.overdue > 0 ? "danger" : "normal"}
        />
        <StatCard
          title={tr("dueIn14Days")}
          value={stats.dueSoon}
          icon={<CalendarDays className="w-5 h-5 text-warning" />}
          tone={stats.dueSoon > 0 ? "warning" : "normal"}
        />
        <StatCard
          title={tr("responseRate")}
          value={
            effectivenessQuery.data
              ? `${Math.round(effectivenessQuery.data.responseRate * 100)}%`
              : "—"
          }
          icon={<Sparkles className="w-5 h-5 text-success" />}
        />
      </div>

      <Tabs defaultValue="missing" className="w-full">
        <TabsList>
          <TabsTrigger value="missing">{tr("missing")}</TabsTrigger>
          <TabsTrigger value="queue">{tr("chaseQueue", { queueCount: queue.length })}</TabsTrigger>
          <TabsTrigger value="calendar">{tr("complianceCalendar")}</TabsTrigger>
          <TabsTrigger value="metrics">{tr("effectiveness")}</TabsTrigger>
        </TabsList>

        {/* Missing documents */}
        <TabsContent value="missing">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>{tr("missingDocuments")}</CardTitle>
                <CardDescription>{tr("whatThisClientStillOwesYou")}</CardDescription>
              </div>
              <Button onClick={() => setShowAddRequirement(true)} data-testid="btn-add-requirement">
                <Plus className="w-4 h-4 me-2" /> {tr("addRequirement")}
              </Button>
            </CardHeader>
            <CardContent>
              {requirementsQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : missingDocs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  {tr("nothingMissingAllCaughtUp")}
                </div>
              ) : (
                <div className="divide-y">
                  {missingDocs.map((r) => {
                    const due = parseISO(r.dueDate);
                    const daysFromDue = differenceInDays(new Date(), due);
                    const isOverdue = daysFromDue > 0;
                    return (
                      <div
                        key={r.id}
                        className="py-3 flex items-center gap-4 flex-wrap"
                        data-testid="row-missing-doc"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{humanize(r.documentType)}</div>
                          {r.description && (
                            <div className="text-sm text-muted-foreground line-clamp-1">
                              {r.description}
                            </div>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {tr("due", { format: format(due, "PP") })}
                        </div>
                        {isOverdue ? (
                          <Badge variant="destructive">{tr("dOverdue", { daysFromDue })}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {tr("inD", { abs: Math.abs(daysFromDue) })}
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => markReceivedMutation.mutate(r.id)}
                          data-testid="btn-mark-received"
                        >
                          <CheckCircle2 className="w-4 h-4 me-1" /> {tr("received")}
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
              <CardTitle>{tr("chaseQueue2")}</CardTitle>
              <CardDescription>{tr("autoBuiltFromDueDatesAnd")}</CardDescription>
            </CardHeader>
            <CardContent>
              {queueQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : queue.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  {tr("noPendingChasesRightNow")}
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
                        <div className="font-medium">{humanize(item.requirement.documentType)}</div>
                        <div className="text-sm text-muted-foreground">
                          {tr("due2", { format: format(parseISO(item.requirement.dueDate), "PP") })}
                          {item.daysOverdue > 0
                            ? tr("dOverdue2", { daysOverdue: item.daysOverdue })
                            : tr("dueNow")}
                        </div>
                      </div>
                      <Badge className={levelBadgeColor(item.nextLevel)}>
                        {humanize(item.nextLevel)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPreviewItem(item)}
                        data-testid="btn-preview-chase"
                      >
                        {tr("preview")}
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
                        <SiWhatsapp className="w-4 h-4 me-2" /> {tr("send")}
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
                <CardTitle>{tr("complianceCalendar2")}</CardTitle>
                <CardDescription>{tr("uaeDeadlinesTradeLicenceVisasFta")}</CardDescription>
              </div>
              <Button onClick={() => setShowAddEvent(true)} data-testid="btn-add-event">
                <Plus className="w-4 h-4 me-2" /> {tr("addDeadline")}
              </Button>
            </CardHeader>
            <CardContent>
              {eventsQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : events.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  {tr("noDeadlinesTrackedYet")}
                </div>
              ) : (
                <div className="divide-y">
                  {events.map((e) => {
                    const ed = parseISO(e.eventDate);
                    const dUntil = differenceInDays(ed, new Date());
                    return (
                      <div
                        key={e.id}
                        className="py-3 flex items-center gap-4 flex-wrap"
                        data-testid="row-event"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{humanize(e.eventType)}</div>
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {e.description}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">{format(ed, "PP")}</div>
                        {dUntil < 0 ? (
                          <Badge variant="destructive">
                            {tr("dOverdue3", { abs: Math.abs(dUntil) })}
                          </Badge>
                        ) : dUntil <= 30 ? (
                          <Badge className="bg-warning-subtle text-warning-subtle-foreground">
                            {tr("inD2", { dUntil })}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{tr("inD2", { dUntil })}</Badge>
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
              <CardTitle>{tr("effectiveness")}</CardTitle>
              <CardDescription>{tr("howWellIsTheChasePipeline")}</CardDescription>
            </CardHeader>
            <CardContent>
              {effectivenessQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Metric
                    label={tr("totalChased")}
                    value={effectivenessQuery.data?.totalChased ?? 0}
                  />
                  <Metric
                    label={tr("totalReceived")}
                    value={effectivenessQuery.data?.totalReceived ?? 0}
                  />
                  <Metric
                    label={tr("responseRate2")}
                    value={
                      effectivenessQuery.data
                        ? `${Math.round(effectivenessQuery.data.responseRate * 100)}%`
                        : "—"
                    }
                  />
                  <Metric
                    label={tr("avgTimeToUpload")}
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
            <DialogTitle>{tr("previewChaseMessage")}</DialogTitle>
            <DialogDescription>{tr("editTheMessageIfYouLike")}</DialogDescription>
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

function StatCard(props: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: "normal" | "warning" | "danger";
}) {
  const ringClass =
    props.tone === "danger"
      ? "border-destructive/30 "
      : props.tone === "warning"
        ? "border-warning/30 "
        : "";
  return (
    <Card className={ringClass}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{props.title}</div>
            <div className="text-2xl font-bold">{props.value}</div>
          </div>
          {props.icon}
        </div>
      </CardContent>
    </Card>
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
  const tr = pageMessages.useT();

  const [draft, setDraft] = useState(props.item.message);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge className={levelBadgeColor(props.item.nextLevel)}>
          {humanize(props.item.nextLevel)}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {tr("due3", {
            humanize: humanize(props.item.requirement.documentType),
            format: format(parseISO(props.item.requirement.dueDate), "PP"),
          })}
        </span>
      </div>
      <Label>{tr("message")}</Label>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} />
      <DialogFooter>
        <Button variant="outline" onClick={props.onCancel}>
          {tr("cancel")}
        </Button>
        <Button onClick={() => props.onSend(draft)} disabled={props.sending}>
          <SiWhatsapp className="w-4 h-4 me-2" /> {tr("sendViaWhatsapp")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function AddRequirementDialog(props: { open: boolean; onClose: () => void; companyId: string }) {
  const tr = pageMessages.useT();

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
      toast({ title: tr("requirementAdded") });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", props.companyId, "document-requirements"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", props.companyId, "document-chases", "queue"],
      });
      props.onClose();
    },
    onError: (e: Error) =>
      toast({ title: tr("failed"), description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("newDocumentRequirement")}</DialogTitle>
          <DialogDescription>{tr("whatDoesThisClientOweYou")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="docType">{tr("documentType")}</Label>
            <Select
              value={form.documentType}
              onValueChange={(v) => setForm((f) => ({ ...f, documentType: v }))}
            >
              <SelectTrigger id="docType" data-testid="select-doctype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="docDescription">{tr("descriptionOptional")}</Label>
            <Input
              id="docDescription"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={tr("q12026BankStatement")}
            />
          </div>
          <div>
            <Label htmlFor="docDueDate">{tr("dueDate")}</Label>
            <Input
              id="docDueDate"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
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
              {tr("recurring")}
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
                  aria-label={tr("recurringIntervalInDays")}
                />
                <span className="text-sm text-muted-foreground">{tr("days")}</span>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {tr("cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.dueDate}
          >
            {tr("add")}
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
  const tr = pageMessages.useT();

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
      toast({ title: tr("deadlineAdded") });
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", props.companyId, "compliance-calendar"],
      });
      props.onClose();
    },
    onError: (e: Error) =>
      toast({ title: tr("failed"), description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("newComplianceDeadline")}</DialogTitle>
          <DialogDescription>{tr("uaeComplianceEventToTrackAnd")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="eventType">{tr("eventType")}</Label>
            <Select
              value={form.eventType}
              onValueChange={(v) => setForm((f) => ({ ...f, eventType: v }))}
            >
              <SelectTrigger id="eventType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLIANCE_EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="eventDescription">{tr("description")}</Label>
            <Input
              id="eventDescription"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={tr("tradeLicenceRenewalAtDubaiEconomy")}
            />
          </div>
          <div>
            <Label htmlFor="eventDate">{tr("date")}</Label>
            <Input
              id="eventDate"
              type="date"
              value={form.eventDate}
              onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {tr("cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.description.trim() || !form.eventDate}
          >
            {tr("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
