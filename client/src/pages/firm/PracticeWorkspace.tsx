/**
 * Practice workspace (W5-D, R15-11/12/14/15): recurring tasks, time + WIP and
 * billing, engagement letters, client links and FTA filing packs for the
 * caller's firm. All copy comes from client/src/locales/{en,ar}/firm.json.
 * Nothing here claims an email, e-signature or FTA submission that did not
 * happen — the API reports those as in-app / requires_external / manual.
 */
import { DatePicker } from "@/components/ui/date-picker";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useFirmPermissions } from "@/hooks/useFirmPermissions";
import { FIRM_UI_PERMISSIONS } from "@shared/access";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { displayTaskTitle } from "./task-title";

type Dict = Record<string, string>;

interface FirmClient {
  id: string;
  name: string;
}
interface FirmContextPayload {
  membership: {
    firm: { name: string } | null;
    role: string;
    permissions: string[];
  } | null;
}
interface FirmTaskRow {
  id: string;
  companyName: string;
  title: string;
  dueDate: string;
  status: string;
}
interface WipRow {
  companyId: string;
  companyName: string;
  unbilledMinutes: number;
  wipValue: string;
  billedAmount: string;
  realisationRate: number | null;
}
interface LetterRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  feeAmount: number | null;
  acceptedName: string | null;
}
interface LinkRow {
  id: string;
  companyName: string | null;
  inviteeEmail: string | null;
  status: string;
}
interface FilingPack {
  trn: { value: string | null; formatValid: boolean; lookupUrl: string };
  submission: { note: { en: string; ar: string } };
  checklist: Array<{ key: string; label: string; done: boolean }>;
  exports: Array<{ key: string; label: string; href: string | null; available: boolean }>;
  filed: { filedOn: string; referenceNumber: string } | null;
}

const ROLE_KEYS: Dict = {
  firm_owner: "firm.roleFirmOwner",
  firm_admin: "firm.roleFirmAdmin",
  preparer: "firm.rolePreparer",
  reviewer: "firm.roleReviewer",
  viewer: "firm.roleViewer",
};
const TASK_STATUS_KEYS: Dict = {
  open: "firm.statusOpen",
  in_progress: "firm.statusInProgress",
  review: "firm.statusReview",
  done: "firm.statusDone",
  cancelled: "firm.statusCancelled",
};
const LINK_STATUS_KEYS: Dict = {
  invited: "firm.linkInvited",
  active: "firm.linkActive",
  revoked: "firm.linkRevoked",
  declined: "firm.linkDeclined",
};

const today = () => new Date().toISOString().slice(0, 10);

function ClientPicker({
  clients,
  value,
  onChange,
  t,
}: {
  clients: FirmClient[];
  value: string;
  onChange: (v: string) => void;
  t: Dict;
}) {
  return (
    <div className="space-y-1">
      <Label>{t["firm.client"]}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-64" aria-label={t["firm.client"]}>
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
  );
}

function useNotify(t: Dict) {
  const { toast } = useToast();
  return {
    ok: (title: string) => toast({ title }),
    fail: (err: unknown) =>
      toast({
        variant: "destructive",
        title: t["firm.failed"],
        description: err instanceof Error ? err.message : undefined,
      }),
  };
}

function TasksTab({ t, canWrite, locale }: { t: Dict; canWrite: boolean; locale: string }) {
  const notify = useNotify(t);
  const { data } = useQuery<{ tasks: FirmTaskRow[] }>({ queryKey: ["/api/firm/tasks"] });
  const generate = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firm/tasks/generate", {}),
    onSuccess: (res: { created: number }) => {
      notify.ok(formatMessage(t["firm.generatedTasks"], { count: res.created }));
      queryClient.invalidateQueries({ queryKey: ["/api/firm/tasks"] });
    },
    onError: notify.fail,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/firm/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/firm/tasks"] }),
    onError: notify.fail,
  });
  const tasks = data?.tasks ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t["firm.tabTasks"]}</CardTitle>
        {canWrite && (
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {t["firm.generateTasks"]}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t["firm.noTasks"]}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t["firm.client"]}</TableHead>
                <TableHead>{t["firm.task"]}</TableHead>
                <TableHead>{t["firm.dueDate"]}</TableHead>
                <TableHead>{t["firm.status"]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>{task.companyName}</TableCell>
                  <TableCell>{displayTaskTitle(task.title, t, locale)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDate(task.dueDate, locale)}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={task.status}
                      disabled={!canWrite}
                      onValueChange={(status) => setStatus.mutate({ id: task.id, status })}
                    >
                      <SelectTrigger className="w-36" aria-label={t["firm.status"]}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TASK_STATUS_KEYS).map(([value, key]) => (
                          <SelectItem key={value} value={value}>
                            {t[key]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TimeTab({ t, clients, canWrite }: { t: Dict; clients: FirmClient[]; canWrite: boolean }) {
  const notify = useNotify(t);
  const [companyId, setCompanyId] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [minutes, setMinutes] = useState("60");
  const [rate, setRate] = useState("");
  const [description, setDescription] = useState("");
  const { data } = useQuery<{ clients: WipRow[] }>({ queryKey: ["/api/firm/wip"] });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/firm/wip"] });
  const log = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/firm/time-entries", {
        companyId,
        entryDate,
        minutes: Number(minutes),
        ...(rate ? { hourlyRate: Number(rate) } : {}),
        ...(description ? { description } : {}),
      }),
    onSuccess: () => {
      notify.ok(t["firm.timeLogged"]);
      refresh();
    },
    onError: notify.fail,
  });
  const bill = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/firm/clients/${id}/bill-wip`, {}),
    onSuccess: () => {
      notify.ok(t["firm.wipBilled"]);
      refresh();
    },
    onError: notify.fail,
  });
  const recurring = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firm/billing/run-recurring", {}),
    onSuccess: (res: { created: number }) =>
      notify.ok(formatMessage(t["firm.recurringBilled"], { count: res.created })),
    onError: notify.fail,
  });
  const rows = data?.clients ?? [];
  return (
    <div className="space-y-4">
      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>{t["firm.logTime"]}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <ClientPicker clients={clients} value={companyId} onChange={setCompanyId} t={t} />
            <div className="space-y-1">
              <Label>{t["firm.entryDate"]}</Label>
              <DatePicker value={entryDate} onChange={(v) => setEntryDate(v)} />
            </div>
            <div className="space-y-1">
              <Label>{t["firm.minutes"]}</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t["firm.hourlyRate"]}</Label>
              <Input type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t["firm.description"]}</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button onClick={() => log.mutate()} disabled={!companyId || log.isPending}>
              {t["firm.logTime"]}
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t["firm.wipTitle"]}</CardTitle>
          {canWrite && (
            <Button
              variant="outline"
              onClick={() => recurring.mutate()}
              disabled={recurring.isPending}
            >
              {t["firm.runRecurringBilling"]}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t["firm.noWip"]}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t["firm.client"]}</TableHead>
                  <TableHead>{t["firm.unbilledMinutes"]}</TableHead>
                  <TableHead>{t["firm.wipValue"]}</TableHead>
                  <TableHead>{t["firm.billedAmount"]}</TableHead>
                  <TableHead>{t["firm.realisation"]}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.companyId}>
                    <TableCell>{r.companyName}</TableCell>
                    <TableCell>{r.unbilledMinutes}</TableCell>
                    <TableCell>{r.wipValue}</TableCell>
                    <TableCell>{r.billedAmount}</TableCell>
                    <TableCell>
                      {r.realisationRate === null ? "—" : `${Math.round(r.realisationRate * 100)}%`}
                    </TableCell>
                    <TableCell>
                      {canWrite && r.unbilledMinutes > 0 && (
                        <Button
                          size="sm"
                          onClick={() => bill.mutate(r.companyId)}
                          disabled={bill.isPending}
                        >
                          {t["firm.billWip"]}
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

function LettersTab({
  t,
  clients,
  canWrite,
}: {
  t: Dict;
  clients: FirmClient[];
  canWrite: boolean;
}) {
  const notify = useNotify(t);
  const [companyId, setCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("engagement");
  const [fee, setFee] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const key = `/api/firm/clients/${companyId}/engagement-letters`;
  const { data } = useQuery<{ letters: LetterRow[] }>({
    queryKey: [key],
    enabled: !!companyId,
  });
  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", key, {
        title,
        kind,
        billingCycle: cycle,
        ...(fee ? { feeAmount: Number(fee) } : {}),
      }),
    onSuccess: () => {
      notify.ok(t["firm.saved"]);
      setTitle("");
      queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: notify.fail,
  });
  const send = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/firm/engagement-letters/${id}/send`, {}),
    onSuccess: () => {
      notify.ok(t["firm.letterShared"]);
      queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: notify.fail,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t["firm.tabLetters"]}</CardTitle>
        <p className="text-sm text-muted-foreground">{t["firm.esignNote"]}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ClientPicker clients={clients} value={companyId} onChange={setCompanyId} t={t} />
        {companyId && canWrite && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>{t["firm.letterTitle"]}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t["firm.letterKind"]}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-44" aria-label={t["firm.letterKind"]}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engagement">{t["firm.kindEngagement"]}</SelectItem>
                  <SelectItem value="proposal">{t["firm.kindProposal"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t["firm.fee"]}</Label>
              <Input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t["firm.billingCycle"]}</Label>
              <Select value={cycle} onValueChange={setCycle}>
                <SelectTrigger className="w-36" aria-label={t["firm.billingCycle"]}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">{t["firm.cycleMonthly"]}</SelectItem>
                  <SelectItem value="quarterly">{t["firm.cycleQuarterly"]}</SelectItem>
                  <SelectItem value="annually">{t["firm.cycleAnnually"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => create.mutate()} disabled={!title || create.isPending}>
              {t["firm.createLetter"]}
            </Button>
          </div>
        )}
        {companyId && (data?.letters ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">{t["firm.noLetters"]}</p>
        )}
        {(data?.letters ?? []).map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded border p-3">
            <div>
              <div className="font-medium">{l.title}</div>
              <div className="text-xs text-muted-foreground">
                {l.kind === "proposal" ? t["firm.kindProposal"] : t["firm.kindEngagement"]}
                {l.acceptedName
                  ? ` · ${formatMessage(t["firm.acceptedBy"], { name: l.acceptedName })}`
                  : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{l.status}</Badge>
              {canWrite && l.status === "draft" && (
                <Button size="sm" onClick={() => send.mutate(l.id)} disabled={send.isPending}>
                  {t["firm.sendLetter"]}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FilingTab({
  t,
  clients,
  canWrite,
  locale,
}: {
  t: Dict;
  clients: FirmClient[];
  canWrite: boolean;
  locale: "en" | "ar";
}) {
  const notify = useNotify(t);
  const [companyId, setCompanyId] = useState("");
  const [filingType, setFilingType] = useState("vat201");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [pack, setPack] = useState<FilingPack | null>(null);
  const [filedOn, setFiledOn] = useState(today());
  const [reference, setReference] = useState("");
  const load = useMutation({
    mutationFn: () =>
      apiRequest(
        "GET",
        `/api/firm/clients/${companyId}/filing-pack?filingType=${filingType}&periodStart=${periodStart}&periodEnd=${periodEnd}`
      ),
    onSuccess: (res: FilingPack) => setPack(res),
    onError: notify.fail,
  });
  const record = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/clients/${companyId}/filings`, {
        filingType,
        periodStart,
        periodEnd,
        filedOn,
        referenceNumber: reference,
      }),
    onSuccess: () => {
      notify.ok(t["firm.filingRecorded"]);
      load.mutate();
    },
    onError: notify.fail,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t["firm.tabFiling"]}</CardTitle>
        <p className="text-sm text-muted-foreground">{t["firm.ftaManualNote"]}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <ClientPicker clients={clients} value={companyId} onChange={setCompanyId} t={t} />
          <div className="space-y-1">
            <Label>{t["firm.filingType"]}</Label>
            <Select value={filingType} onValueChange={setFilingType}>
              <SelectTrigger className="w-56" aria-label={t["firm.filingType"]}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vat201">{t["firm.filingVat"]}</SelectItem>
                <SelectItem value="ct">{t["firm.filingCt"]}</SelectItem>
                <SelectItem value="faf">{t["firm.filingFaf"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t["firm.periodStart"]}</Label>
            <DatePicker value={periodStart} onChange={(v) => setPeriodStart(v)} />
          </div>
          <div className="space-y-1">
            <Label>{t["firm.periodEnd"]}</Label>
            <DatePicker value={periodEnd} onChange={(v) => setPeriodEnd(v)} />
          </div>
          <Button
            onClick={() => load.mutate()}
            disabled={!companyId || !periodStart || !periodEnd || load.isPending}
          >
            {t["firm.loadPack"]}
          </Button>
        </div>
        {pack && (
          <div className="space-y-3">
            <p className="text-sm">{pack.submission.note[locale]}</p>
            <div className="text-sm">
              <span className="font-medium">{t["firm.trnCheck"]}: </span>
              {pack.trn.value ?? "—"} ·{" "}
              {pack.trn.formatValid ? t["firm.trnValid"] : t["firm.trnInvalid"]} ·{" "}
              <a className="underline" href={pack.trn.lookupUrl} target="_blank" rel="noreferrer">
                {t["firm.ftaLookup"]}
              </a>
            </div>
            <div>
              <div className="font-medium">{t["firm.checklist"]}</div>
              <ul className="list-disc ps-6 text-sm">
                {pack.checklist.map((c) => (
                  <li key={c.key}>
                    {c.done ? "✓" : "○"} {c.label}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-medium">{t["firm.exports"]}</div>
              <ul className="ps-2 text-sm">
                {pack.exports.map((e) => (
                  <li key={e.key}>
                    {e.label} ·{" "}
                    {e.available && e.href ? (
                      <a className="underline" href={e.href}>
                        {t["firm.download"]}
                      </a>
                    ) : (
                      t["firm.notAvailable"]
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {pack.filed ? (
              <Badge>
                {formatMessage(t["firm.alreadyFiled"], {
                  date: pack.filed.filedOn,
                  ref: pack.filed.referenceNumber,
                })}
              </Badge>
            ) : (
              canWrite && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label>{t["firm.filedOn"]}</Label>
                    <DatePicker value={filedOn} onChange={(v) => setFiledOn(v)} />
                  </div>
                  <div className="space-y-1">
                    <Label>{t["firm.referenceNumber"]}</Label>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                  <Button onClick={() => record.mutate()} disabled={!reference || record.isPending}>
                    {t["firm.recordFiling"]}
                  </Button>
                </div>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinksTab({ t, canWrite }: { t: Dict; canWrite: boolean }) {
  // `canWrite` is the firm.clients.link permission here (the routes require it, not "any write").
  const notify = useNotify(t);
  const [email, setEmail] = useState("");
  const { data } = useQuery<{ links: LinkRow[] }>({ queryKey: ["/api/firm/client-links"] });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/firm/client-links"] });
  const invite = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firm/client-links", { inviteeEmail: email }),
    onSuccess: () => {
      notify.ok(t["firm.inviteCreated"]);
      setEmail("");
      refresh();
    },
    onError: notify.fail,
  });
  const end = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/firm/client-links/${id}`),
    onSuccess: refresh,
    onError: notify.fail,
  });
  const links = data?.links ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t["firm.tabLinks"]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="firm-invitee-email">{t["firm.inviteeEmail"]}</Label>
              <Input
                id="firm-invitee-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button onClick={() => invite.mutate()} disabled={!email || invite.isPending}>
              {t["firm.sendInvite"]}
            </Button>
          </div>
        )}
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t["firm.noLinks"]}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t["firm.client"]}</TableHead>
                <TableHead>{t["firm.linkStatus"]}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.companyName ?? l.inviteeEmail}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t[LINK_STATUS_KEYS[l.status] ?? ""] ?? l.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canWrite && (l.status === "active" || l.status === "invited") && (
                      <Button size="sm" variant="outline" onClick={() => end.mutate(l.id)}>
                        {t["firm.endLink"]}
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
  );
}

export default function PracticeWorkspace() {
  const { t, locale } = useTranslation();
  const dict = t as Dict;
  const { data: context } = useQuery<FirmContextPayload>({ queryKey: ["/api/firm/context"] });
  // Names only: the other tabs pick a client, they do not need the portfolio payload.
  const { data: clients = [] } = useQuery<FirmClient[]>({
    queryKey: ["/api/firm/clients?view=names"],
  });
  const membership = context?.membership ?? null;
  const { can } = useFirmPermissions();
  const canWrite = (membership?.permissions ?? []).some((p) => !p.endsWith(".read"));
  const canLink = can(FIRM_UI_PERMISSIONS.linkClient);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firm"
        title={dict["firm.practiceWorkspace"]}
        description={dict["firm.practiceSubtitle"]}
      />
      {membership && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span>
            {dict["firm.firmLabel"]}: {membership.firm?.name ?? "—"}
          </span>
          <Badge variant="secondary">
            {dict["firm.yourRole"]}: {dict[ROLE_KEYS[membership.role] ?? ""] ?? membership.role}
          </Badge>
          {!canWrite && <Badge variant="outline">{dict["firm.readOnly"]}</Badge>}
        </div>
      )}
      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">{dict["firm.tabTasks"]}</TabsTrigger>
          <TabsTrigger value="time">{dict["firm.tabTime"]}</TabsTrigger>
          <TabsTrigger value="letters">{dict["firm.tabLetters"]}</TabsTrigger>
          <TabsTrigger value="filing">{dict["firm.tabFiling"]}</TabsTrigger>
          <TabsTrigger value="links">{dict["firm.tabLinks"]}</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks">
          <TasksTab t={dict} canWrite={canWrite} locale={locale} />
        </TabsContent>
        <TabsContent value="time">
          <TimeTab t={dict} clients={clients} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="letters">
          <LettersTab t={dict} clients={clients} canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="filing">
          <FilingTab t={dict} clients={clients} canWrite={canWrite} locale={locale} />
        </TabsContent>
        <TabsContent value="links">
          <LinksTab t={dict} canWrite={canLink} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
