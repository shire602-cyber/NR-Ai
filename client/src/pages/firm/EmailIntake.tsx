import { T } from "@/components/layout/T";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { SetupNotice } from "@/components/ui/setup-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, refreshAfterWrite } from "@/lib/queryClient";
import { useTranslation, formatMessage, translateNow } from "@/lib/i18n";
import { Plus, Trash2, Mail, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { ErrorState } from "@/components/ui/error-state";
import { PausedReadNotice } from "@/components/ui/paused-read-notice";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { hasReadData, queryReadState, type QueryReadState } from "@/lib/queryReadState";

// ─── Types (mirror the firm email-intake API) ──────────────────────────────
interface EmailSource {
  id: string;
  companyId: string;
  senderEmail: string;
  label: string | null;
  status: "active" | "paused";
  requireDkimPass: boolean;
  createdAt: string;
}
interface EmailToTaskStatus {
  automatic: boolean;
  mailbox: "disabled" | "connected" | "requires_external";
  note: { en: string; ar: string };
}
interface SourcesResponse {
  sources: EmailSource[];
  featureEnabled: boolean;
  mailboxConfigured: boolean;
  emailToTask?: EmailToTaskStatus;
}
interface IntakeMessage {
  id: string;
  fromEmail: string;
  subject: string | null;
  receivedAt: string;
  attachmentCount: number;
  status: string;
  taskId: string | null;
}
export interface ClientCompany {
  id: string;
  name: string;
}

function CompletenessPanel({ clients }: { clients: ClientCompany[] }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    Tab?: typeof import("./EmailIntakeCompletenessTab").default;
  }>();

  useEffect(() => {
    let active = true;
    void import("./EmailIntakeCompletenessTab").then(
      ({ default: Tab }) => {
        if (active) setResult({ attempt, Tab });
      },
      () => {
        if (active) setResult({ attempt });
      }
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (result?.attempt !== attempt) return <Skeleton className="h-24 w-full" />;
  if (result.Tab) return <result.Tab clients={clients} />;

  return (
    <ErrorState
      compact
      title={t["emailIntake.completenessLoadFailed"]}
      description={t["emailIntake.completenessLoadHelp"]}
      onRetry={() => setAttempt(attempt + 1)}
      testId="email-intake-completeness-error"
    />
  );
}

export default function EmailIntake() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const sourcesQuery = useQuery<SourcesResponse>({
    queryKey: ["/api/firm/email-intake/sources"],
    queryFn: ({ signal }) =>
      apiRequest("GET", "/api/firm/email-intake/sources", undefined, undefined, { signal }),
  });
  const clientsQuery = useQuery<ClientCompany[]>({
    queryKey: ["/api/firm/clients"],
    queryFn: ({ signal }) =>
      apiRequest("GET", "/api/firm/clients", undefined, undefined, { signal }),
  });
  const sourcesState = queryReadState(sourcesQuery);
  const clientsState = queryReadState(clientsQuery);
  const sourcesData = hasReadData(sourcesState) ? sourcesQuery.data : undefined;
  const clients = useMemo(
    () => (hasReadData(clientsState) ? (clientsQuery.data ?? []) : []),
    [clientsState, clientsQuery.data]
  );

  const clientName = useMemo(() => {
    const m = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? id;
  }, [clients]);

  const featureOff = sourcesData && !sourcesData.featureEnabled;
  const mailboxOff = sourcesData && sourcesData.featureEnabled && !sourcesData.mailboxConfigured;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["emailIntake.nraCenter"]}
        title={t["emailIntake.emailDocumentIntake"]}
        description={t["emailIntake.clientsEmailTheirDocumentsThe"]}
      />

      {featureOff && (
        <SetupNotice title={t["firmOps.intakeOffTitle"]} testId="email-intake-off">
          {t["firmOps.intakeOffBody"]}
        </SetupNotice>
      )}
      {mailboxOff && (
        <SetupNotice title={t["pages.noMailboxConnected"]} testId="email-intake-no-mailbox">
          {t["firmOps.intakeNoMailboxBody"]}
        </SetupNotice>
      )}

      {clientsState === "pending" && (
        <Skeleton className="h-8 w-full" data-testid="email-intake-clients-loading" />
      )}
      {clientsState === "error" && (
        <LoadErrorState
          compact
          error={clientsQuery.error}
          onRetry={() => void clientsQuery.refetch()}
          testId="email-intake-clients-error"
        />
      )}
      {clientsState === "stale" && (
        <StaleDataNotice
          onRetry={() => void clientsQuery.refetch()}
          testId="email-intake-clients-stale"
        />
      )}

      <Tabs defaultValue="senders">
        <TabsList>
          <TabsTrigger value="senders" data-testid="tab-senders">
            <T k="pages.senderMappings" />
          </TabsTrigger>
          <TabsTrigger value="completeness" data-testid="tab-completeness">
            <T k="pages.completenessCheck" />
          </TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-email-tasks">
            <T k="firm.emailTasksTab" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="senders" className="mt-4">
          <SendersTab
            sources={sourcesData?.sources ?? []}
            readState={sourcesState}
            error={sourcesQuery.error}
            onRetry={() => void sourcesQuery.refetch()}
            clients={clients}
            clientName={clientName}
            toast={toast}
          />
        </TabsContent>

        <TabsContent value="completeness" className="mt-4">
          <CompletenessPanel clients={clients} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <EmailTasksTab
            clients={clients}
            status={sourcesData?.emailToTask}
            statusState={sourcesState}
            onRetryStatus={() => void sourcesQuery.refetch()}
            toast={toast}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sender mappings ────────────────────────────────────────────────────────
function SendersTab({
  sources,
  readState,
  error,
  onRetry,
  clients,
  clientName,
  toast,
}: {
  sources: EmailSource[];
  readState: QueryReadState;
  error: unknown;
  onRetry: () => void;
  clients: ClientCompany[];
  clientName: (id: string) => string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const { t } = useTranslation();
  const [companyId, setCompanyId] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [label, setLabel] = useState("");
  const [requireDkim, setRequireDkim] = useState(true);

  const invalidate = () => refreshAfterWrite(["/api/firm/email-intake/sources"]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/firm/email-intake/sources", {
        companyId,
        senderEmail,
        label: label || undefined,
        requireDkimPass: requireDkim,
      }),
    onSuccess: () => {
      toast({
        title: translateNow("toasts.senderLinked"),
        description: `${senderEmail} → ${clientName(companyId)}`,
      });
      setSenderEmail("");
      setLabel("");
      invalidate();
    },
    onError: (e: any) =>
      toast({
        title: translateNow("toasts.couldNotLinkSender"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const toggleMutation = useMutation({
    mutationFn: (s: EmailSource) =>
      apiRequest("PATCH", `/api/firm/email-intake/sources/${s.id}`, {
        status: s.status === "active" ? "paused" : "active",
      }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/firm/email-intake/sources/${id}`),
    onSuccess: () => {
      toast({ title: t["emailIntake.mappingRemoved"] });
      invalidate();
    },
  });

  const canAdd = companyId && /.+@.+\..+/.test(senderEmail);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <T k="pages.linkASenderToAClient" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>
                <T k="pages.client" />
              </Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger aria-label={t["pages.client"]} data-testid="select-client">
                  <SelectValue placeholder={t["bulkOperations.selectClient"]} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                <T k="pages.senderEmail" />
              </Label>
              <Input
                type="email"
                placeholder="billing@client.ae"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                data-testid="input-sender-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t["emailIntake.labelOptional"]}</Label>
              <Input
                placeholder={t["firmOps.intakeLabelPlaceholder"]}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={requireDkim} onCheckedChange={setRequireDkim} id="dkim" />
                <Label htmlFor="dkim" className="cursor-pointer">
                  <T k="pages.requireDkim" />
                </Label>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canAdd || createMutation.isPending}
              data-testid="button-add-sender"
            >
              <Plus className="h-4 w-4 me-1" /> <T k="pages.linkSender" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {hasReadData(readState) ? (
              formatMessage(t["emailIntake.linkedSendersCount"], { count: sources.length })
            ) : (
              <T k="pages.senderMappings" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {readState === "stale" && (
            <StaleDataNotice onRetry={onRetry} testId="email-intake-sources-stale" />
          )}
          {readState === "pending" ? (
            <Skeleton className="h-24 w-full" data-testid="email-intake-sources-loading" />
          ) : readState === "error" ? (
            <LoadErrorState
              compact
              error={error}
              onRetry={onRetry}
              testId="email-intake-sources-error"
            />
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <T k="pages.noSendersLinkedYet" />
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.sender" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.client" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.label" />
                  </TableHead>
                  <TableHead>DKIM</TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="pages.actions" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id} data-testid={`row-source-${s.id}`}>
                    <TableCell className="font-medium">{s.senderEmail}</TableCell>
                    <TableCell>{clientName(s.companyId)}</TableCell>
                    <TableCell className="text-muted-foreground">{s.label ?? "—"}</TableCell>
                    <TableCell>
                      {s.requireDkimPass
                        ? t["firmOps.intakeDkimRequired"]
                        : t["firmOps.intakeDkimOff"]}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"}>
                        {s.status === "active"
                          ? t["firmOps.intakeStatusActive"]
                          : t["firmOps.intakeStatusPaused"]}
                      </Badge>
                    </TableCell>
                    <TableCell data-numeric>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleMutation.mutate(s)}
                        >
                          {s.status === "active"
                            ? t["firmOps.intakePause"]
                            : t["firmOps.intakeResume"]}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(s.id)}
                          data-testid={`button-delete-${s.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Email-to-task (S4, R15-15) ─────────────────────────────────────────────
function EmailTasksTab({
  clients,
  status,
  statusState,
  onRetryStatus,
  toast,
}: {
  clients: ClientCompany[];
  status: EmailToTaskStatus | undefined;
  /** Read state of the query `status` comes from: unknown must not read as "no mailbox". */
  statusState: QueryReadState;
  onRetryStatus: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const { t, locale } = useTranslation();
  const [companyId, setCompanyId] = useState("");
  const messagesKey = [`/api/firm/email-intake/messages/${companyId}`];
  // Another tenant's company is a 404: that must drop cached messages, like a 403.
  const messagesOptions = { queryKey: messagesKey, meta: { tenantScoped: true } };
  const messagesQuery = useQuery<{ messages: IntakeMessage[] }>({
    ...messagesOptions,
    queryFn: ({ signal }) => apiRequest("GET", messagesKey[0], undefined, undefined, { signal }),
    enabled: !!companyId,
  });
  const messagesState = queryReadState({ ...messagesQuery, ...messagesOptions });
  const messagesPaused = messagesQuery.fetchStatus === "paused";
  const createTask = useMutation({
    mutationFn: (messageId: string) =>
      apiRequest("POST", `/api/firm/email-intake/messages/${messageId}/task`, {}),
    onSuccess: () => {
      refreshAfterWrite(messagesKey);
      toast({ title: t["firm.emailTaskCreated"] });
    },
    onError: (e: Error) =>
      toast({ title: t["firm.emailTaskFailed"], description: e.message, variant: "destructive" }),
  });
  const messages = hasReadData(messagesState) ? (messagesQuery.data?.messages ?? []) : [];

  return (
    <div className="space-y-4">
      {statusState === "stale" && (
        <StaleDataNotice onRetry={onRetryStatus} testId="email-task-mailbox-stale" />
      )}
      <Alert data-testid="email-task-boundary">
        <Mail className="h-4 w-4" />
        <AlertTitle>
          {statusState === "pending" ? (
            <T k="firm.emailTasksMailboxChecking" />
          ) : statusState === "error" ? (
            <T k="firm.emailTasksMailboxUnavailable" />
          ) : status?.mailbox === "connected" ? (
            <T k="firm.emailTasksMailboxConnected" />
          ) : status?.mailbox === "requires_external" ? (
            <T k="firm.emailTasksMailboxExternal" />
          ) : status?.mailbox === "disabled" ? (
            <T k="firm.emailTasksMailboxDisabled" />
          ) : (
            <T k="firm.emailTasksMailboxUnavailable" />
          )}
        </AlertTitle>
        <AlertDescription>
          <T k="firm.emailTasksHint" />
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <T k="firm.emailTasksTitle" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm space-y-1">
            <Label>
              <T k="pages.client" />
            </Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger aria-label={t["pages.client"]} data-testid="select-email-task-client">
                <SelectValue placeholder={t["firm.selectClient"]} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {companyId &&
            messagesState === "pending" &&
            (messagesPaused ? (
              <PausedReadNotice testId="email-intake-messages-waiting" />
            ) : (
              <Skeleton className="h-24 w-full" data-testid="email-intake-messages-loading" />
            ))}
          {companyId && messagesState === "error" && (
            <LoadErrorState
              compact
              error={messagesQuery.error}
              onRetry={() => void messagesQuery.refetch()}
              testId="email-intake-messages-error"
            />
          )}
          {companyId && messagesPaused && hasReadData(messagesState) && (
            <PausedReadNotice cached testId="email-intake-messages-paused-cached" />
          )}
          {companyId && !messagesPaused && messagesState === "stale" && (
            <StaleDataNotice
              onRetry={() => void messagesQuery.refetch()}
              testId="email-intake-messages-stale"
            />
          )}
          {companyId && hasReadData(messagesState) && messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <T k="firm.emailTasksNoMessages" />
            </p>
          )}
          {messages.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.sender" />
                  </TableHead>
                  <TableHead>
                    <T k="firm.emailTasksSubject" />
                  </TableHead>
                  <TableHead>
                    <T k="firm.emailTasksReceived" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="firm.task" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((m) => (
                  <TableRow key={m.id} data-testid={`row-intake-message-${m.id}`}>
                    <TableCell className="tabular-nums text-xs">{m.fromEmail}</TableCell>
                    <TableCell>{m.subject ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(m.receivedAt).toLocaleString(locale === "ar" ? "ar-AE" : "en-AE")}
                    </TableCell>
                    <TableCell data-numeric>
                      {m.taskId ? (
                        <Badge variant="secondary">
                          <CheckCircle2 className="h-3 w-3 me-1" />
                          <T k="firm.emailTaskExists" />
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={createTask.isPending}
                          onClick={() => createTask.mutate(m.id)}
                          data-testid={`button-create-email-task-${m.id}`}
                        >
                          <Plus className="h-4 w-4 me-1" />
                          <T k="firm.emailTaskCreate" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
