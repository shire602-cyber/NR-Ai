import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Inbox, Plus, Trash2, Mail, AlertTriangle, CheckCircle2 } from "lucide-react";

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
interface SourcesResponse {
  sources: EmailSource[];
  featureEnabled: boolean;
  mailboxConfigured: boolean;
}
interface ClientCompany {
  id: string;
  name: string;
}
interface EvidenceGap {
  bankTransactionId: string;
  date: string;
  amount: number;
  direction: "inflow" | "outflow";
  kind: "missing_purchase_evidence" | "missing_sales_evidence";
  description: string;
}
interface CompletenessResult {
  summary: {
    totalLines: number;
    matchedLines: number;
    unmatchedLines: number;
    coverageRatio: number;
    unmatchedOutflowValue: number;
    unmatchedInflowValue: number;
    gapCount: number;
  };
  gaps: EvidenceGap[];
}

const fmtAed = (n: number) =>
  `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EmailIntake() {
  const { toast } = useToast();

  const { data: sourcesData } = useQuery<SourcesResponse>({
    queryKey: ["/api/firm/email-intake/sources"],
    queryFn: () => apiRequest("GET", "/api/firm/email-intake/sources"),
  });
  const { data: clients = [] } = useQuery<ClientCompany[]>({
    queryKey: ["/api/firm/clients"],
    queryFn: () => apiRequest("GET", "/api/firm/clients"),
  });

  const clientName = useMemo(() => {
    const m = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? id;
  }, [clients]);

  const featureOff = sourcesData && !sourcesData.featureEnabled;
  const mailboxOff = sourcesData && sourcesData.featureEnabled && !sourcesData.mailboxConfigured;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="NRA Center"
        icon={Inbox}
        title="Email Document Intake"
        description="Clients email their documents; the AI extracts and drafts the bookkeeping for your review. Pilot — NRA clients only."
      />

      {featureOff && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Pilot disabled</AlertTitle>
          <AlertDescription>
            Set <code>EMAIL_INTAKE_ENABLED=true</code> on the server to turn the intake pilot on. You
            can still configure sender mappings below; nothing is ingested until it's enabled.
          </AlertDescription>
        </Alert>
      )}
      {mailboxOff && (
        <Alert>
          <Mail className="h-4 w-4" />
          <AlertTitle>No mailbox connected</AlertTitle>
          <AlertDescription>
            The pilot is enabled but no mailbox is wired (<code>EMAIL_INTAKE_PROVIDER</code>). Sender
            mappings are saved and ready; ingestion starts once a mailbox is connected.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="senders">
        <TabsList>
          <TabsTrigger value="senders" data-testid="tab-senders">
            Sender mappings
          </TabsTrigger>
          <TabsTrigger value="completeness" data-testid="tab-completeness">
            Completeness check
          </TabsTrigger>
        </TabsList>

        <TabsContent value="senders" className="mt-4">
          <SendersTab sources={sourcesData?.sources ?? []} clients={clients} clientName={clientName} toast={toast} />
        </TabsContent>

        <TabsContent value="completeness" className="mt-4">
          <CompletenessTab clients={clients} toast={toast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sender mappings ────────────────────────────────────────────────────────
function SendersTab({
  sources,
  clients,
  clientName,
  toast,
}: {
  sources: EmailSource[];
  clients: ClientCompany[];
  clientName: (id: string) => string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [companyId, setCompanyId] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [label, setLabel] = useState("");
  const [requireDkim, setRequireDkim] = useState(true);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/firm/email-intake/sources"] });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/firm/email-intake/sources", {
        companyId,
        senderEmail,
        label: label || undefined,
        requireDkimPass: requireDkim,
      }),
    onSuccess: () => {
      toast({ title: "Sender linked", description: `${senderEmail} → ${clientName(companyId)}` });
      setSenderEmail("");
      setLabel("");
      invalidate();
    },
    onError: (e: any) => toast({ title: "Could not link sender", description: e.message, variant: "destructive" }),
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
      toast({ title: "Mapping removed" });
      invalidate();
    },
  });

  const canAdd = companyId && /.+@.+\..+/.test(senderEmail);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link a sender to a client</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger data-testid="select-client">
                  <SelectValue placeholder="Select client" />
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
              <Label>Sender email</Label>
              <Input
                type="email"
                placeholder="billing@client.ae"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                data-testid="input-sender-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Label (optional)</Label>
              <Input placeholder="e.g. Accounts payable" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={requireDkim} onCheckedChange={setRequireDkim} id="dkim" />
                <Label htmlFor="dkim" className="cursor-pointer">
                  Require DKIM
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
              <Plus className="h-4 w-4 mr-1" /> Link sender
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linked senders ({sources.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No senders linked yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>DKIM</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id} data-testid={`row-source-${s.id}`}>
                    <TableCell className="font-medium">{s.senderEmail}</TableCell>
                    <TableCell>{clientName(s.companyId)}</TableCell>
                    <TableCell className="text-muted-foreground">{s.label ?? "—"}</TableCell>
                    <TableCell>{s.requireDkimPass ? "Required" : "Off"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => toggleMutation.mutate(s)}>
                        {s.status === "active" ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(s.id)}
                        data-testid={`button-delete-${s.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

// ─── Completeness check ───────────────────────────────────────────────────────
function CompletenessTab({
  clients,
  toast,
}: {
  clients: ClientCompany[];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [companyId, setCompanyId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [result, setResult] = useState<CompletenessResult | null>(null);

  const canRun = companyId && periodStart && periodEnd;

  const runMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "GET",
        `/api/firm/email-intake/completeness/${companyId}?periodStart=${periodStart}&periodEnd=${periodEnd}`
      ),
    onSuccess: (data: CompletenessResult) => setResult(data),
    onError: (e: any) => toast({ title: "Could not load", description: e.message, variant: "destructive" }),
  });

  const chaseMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/email-intake/completeness/${companyId}/chase`, {
        periodStart,
        periodEnd,
      }),
    onSuccess: (r: { created: number; skipped: number }) =>
      toast({
        title: "Chase requests raised",
        description: `${r.created} created, ${r.skipped} already chased`,
      }),
    onError: (e: any) => toast({ title: "Could not raise chases", description: e.message, variant: "destructive" }),
  });

  const coveragePct = result ? Math.round(result.summary.coverageRatio * 100) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check a period for missing documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger data-testid="select-completeness-client">
                  <SelectValue placeholder="Select client" />
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
              <Label>Period start</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Period end</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => runMutation.mutate()} disabled={!canRun || runMutation.isPending}>
                Run check
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {result.summary.gapCount === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-warning" />
              )}
              Coverage {coveragePct}% · {result.summary.gapCount} gap
              {result.summary.gapCount === 1 ? "" : "s"}
            </CardTitle>
            {result.summary.gapCount > 0 && (
              <Button onClick={() => chaseMutation.mutate()} disabled={chaseMutation.isPending} data-testid="button-chase">
                Create chase requests
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Stat label="Bank lines" value={String(result.summary.totalLines)} />
              <Stat label="Matched" value={String(result.summary.matchedLines)} />
              <Stat label="Missing purchases" value={fmtAed(result.summary.unmatchedOutflowValue)} />
              <Stat label="Missing sales" value={fmtAed(result.summary.unmatchedInflowValue)} />
            </div>

            {result.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every bank line in this period has a matching document. Nothing to chase.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.gaps.map((g) => (
                    <TableRow key={g.bankTransactionId}>
                      <TableCell>{g.date.slice(0, 10)}</TableCell>
                      <TableCell className="max-w-[320px] truncate">{g.description || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={g.direction === "outflow" ? "secondary" : "outline"}>
                          {g.kind === "missing_purchase_evidence" ? "Purchase" : "Sales"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtAed(g.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
