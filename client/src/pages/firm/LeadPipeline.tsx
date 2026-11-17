import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, ChevronDown, ChevronUp, X, UserPlus, MoreHorizontal, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation, formatMessage, translateNow } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "prospect" | "contacted" | "interested" | "converted" | "lost";
type Source = "saas_signup" | "referral" | "manual" | "website";

interface Lead {
  id: string;
  userId: string;
  companyId: string | null;
  stage: Stage;
  source: Source;
  notes: string | null;
  score: number;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userEmail: string;
  userName: string;
  companyName: string | null;
}

interface PipelineData {
  leads: Lead[];
  byStage: Record<Stage, Lead[]>;
  stageCounts: Record<Stage, number>;
  conversionRate: number;
  avgDaysToConvert: number | null;
  totalLeads: number;
}

interface SaasProspect {
  userId: string;
  email: string;
  name: string;
  companyCount: number;
  transactionCount: number;
  lastActive: string;
  suggestedScore: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGES: { key: Stage; label: string; color: string; bg: string }[] = [
  {
    key: "prospect",
    label: "leadPipeline.stage.prospect",
    color: "text-foreground",
    bg: "bg-surface-sunken border-border",
  },
  {
    key: "contacted",
    label: "leadPipeline.stage.contacted",
    color: "text-foreground",
    bg: "bg-surface-sunken border-border",
  },
  {
    key: "interested",
    label: "leadPipeline.stage.interested",
    color: "text-foreground",
    bg: "bg-surface-sunken border-border",
  },
  {
    key: "converted",
    label: "firmOps.stageConverted",
    color: "text-foreground",
    bg: "bg-surface-sunken border-border",
  },
  {
    key: "lost",
    label: "leadPipeline.stage.lost",
    color: "text-foreground",
    bg: "bg-surface-sunken border-border",
  },
];

// Spec 2.3: no traffic-light fills; the score is a neutral pill.
const SCORE_PILL = "bg-neutral-subtle text-neutral-subtle-foreground border-transparent";

const SOURCE_LABELS: Record<Source, string> = {
  saas_signup: "pages.saasSignup",
  referral: "pages.referral",
  manual: "pages.manual",
  website: "pages.website",
};

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  onEdit,
  onDragStart,
}: {
  lead: Lead;
  onEdit: (lead: Lead) => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      className="group bg-background border rounded-lg p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{lead.userEmail}</p>
          {lead.companyName && (
            <p className="text-xs text-muted-foreground truncate">{lead.companyName}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge className={`text-xs px-1.5 py-0 border ${SCORE_PILL}`}>{lead.score}</Badge>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 opacity-0 group-hover:opacity-100"
            onClick={() => onEdit(lead)}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs px-1.5 py-0">
          <T k={SOURCE_LABELS[lead.source] ?? "pages.manual"} />
        </Badge>
      </div>

      {lead.notes && <p className="text-xs text-muted-foreground line-clamp-2">{lead.notes}</p>}
    </div>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  leads,
  onEdit,
  onDragStart,
  onDrop,
  isDragOver,
  onDragOver,
  onDragLeave,
}: {
  stage: (typeof STAGES)[0];
  leads: Lead[];
  onEdit: (lead: Lead) => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  onDrop: (e: React.DragEvent, targetStage: Stage) => void;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col min-w-[200px] flex-1 rounded-xl border ${stage.bg} transition-colors ${isDragOver ? "ring-2 ring-primary ring-offset-1" : ""}`}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, stage.key)}
      onDragLeave={onDragLeave}
    >
      <div className="px-3 py-2.5 border-b flex items-center justify-between">
        <span className={`text-sm font-semibold ${stage.color}`}>{t[stage.label]}</span>
        <Badge variant="secondary" className="text-xs">
          {leads.length}
        </Badge>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onEdit={onEdit} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  );
}

// ─── Add Lead dialog ──────────────────────────────────────────────────────────

function AddLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<Source>("manual");
  const { data: prospects = [] } = useQuery<SaasProspect[]>({
    queryKey: ["/api/firm/pipeline/saas-prospects"],
    enabled: open,
  });
  const [stage, setStage] = useState<Stage>("prospect");

  const mutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/firm/pipeline/leads", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/pipeline"] });
      toast({ title: t["leadPipeline.leadAdded"] });
      onClose();
      setUserId("");
      setNotes("");
    },
    onError: () => toast({ title: translateNow("toasts.failedToAddLead"), variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!userId.trim()) return;
    // The score is derived from the person's activity (the same suggestion the sign-ups
    // list uses); there is no manual score input.
    const suggested = prospects.find((p) => p.userId === userId)?.suggestedScore ?? 50;
    mutation.mutate({
      userId: userId.trim(),
      notes: notes || undefined,
      score: suggested,
      source,
      stage,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <T k="pages.addLead" />
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="lead-person">{t["firmOps.leadPerson"]}</Label>
            {/* WP-E: pick the person from the platform's sign-ups instead of typing an id. */}
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="lead-person" data-testid="select-lead-person">
                <SelectValue placeholder={t["firmOps.leadPersonPlaceholder"]} />
              </SelectTrigger>
              <SelectContent>
                {prospects.map((p) => (
                  <SelectItem key={p.userId} value={p.userId}>
                    {p.name ? `${p.name} · ${p.email}` : p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prospects.length === 0 && (
              <p className="text-small text-muted-foreground">{t["firmOps.leadPersonEmpty"]}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                <T k="pages.stage" />
              </Label>
              <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {t[s.label]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                <T k="pages.source" />
              </Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">
                    <T k="pages.manual" />
                  </SelectItem>
                  <SelectItem value="saas_signup">
                    <T k="pages.saasSignup" />
                  </SelectItem>
                  <SelectItem value="referral">
                    <T k="pages.referral" />
                  </SelectItem>
                  <SelectItem value="website">
                    <T k="pages.website" />
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              <T k="pages.notes" />
            </Label>
            <Textarea
              placeholder={t["leadPipeline.optionalNotes"]}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <T k="pages.cancel" />
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending || !userId.trim()}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
            <T k="pages.addLead" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Lead dialog ─────────────────────────────────────────────────────────

function EditLeadDialog({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const score = String(lead?.score ?? 50);
  const [stage, setStage] = useState<Stage>(lead?.stage ?? "prospect");

  const updateMutation = useMutation({
    mutationFn: (data: object) => apiRequest("PUT", `/api/firm/pipeline/leads/${lead!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/pipeline"] });
      toast({ title: t["leadPipeline.leadUpdated"] });
      onClose();
    },
    onError: () => toast({ title: translateNow("toasts.failedToUpdate"), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/firm/pipeline/leads/${lead!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/pipeline"] });
      toast({ title: t["leadPipeline.leadRemoved"] });
      onClose();
    },
    onError: () => toast({ title: translateNow("toasts.failedToDelete"), variant: "destructive" }),
  });

  if (!lead) return null;

  return (
    <Dialog open={!!lead} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t["firmOps.editLead"]}</DialogTitle>
          <p className="text-small text-muted-foreground" dir="ltr">
            {lead.userEmail}
          </p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
            {lead.companyName && (
              <>
                <dt className="text-muted-foreground">{t["firmOps.leadCompany"]}</dt>
                <dd>{lead.companyName}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t["pages.source"]}</dt>
            <dd>{t[SOURCE_LABELS[lead.source] ?? "pages.manual"]}</dd>
            <dt className="text-muted-foreground">{t["firmOps.leadAdded"]}</dt>
            <dd>{formatDate(lead.createdAt, locale)}</dd>
            {lead.convertedAt && (
              <>
                <dt className="text-muted-foreground">{t["firmOps.leadConverted"]}</dt>
                <dd>{formatDate(lead.convertedAt, locale)}</dd>
              </>
            )}
          </dl>
          <div className="space-y-1.5">
            <Label>
              <T k="pages.stage" />
            </Label>
            <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {t[s.label]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              <T k="pages.notes" />
            </Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
            {t["firmOps.delete"]}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={() =>
                updateMutation.mutate({ stage, notes: notes || null, score: Number(score) })
              }
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin me-1" /> : null}
              {t["firmOps.save"]}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Auto-discover panel ──────────────────────────────────────────────────────

function AutoDiscoverPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const { data: prospects = [], isLoading } = useQuery<SaasProspect[]>({
    queryKey: ["/api/firm/pipeline/saas-prospects"],
  });

  const addMutation = useMutation({
    mutationFn: (prospect: SaasProspect) =>
      apiRequest("POST", "/api/firm/pipeline/leads", {
        userId: prospect.userId,
        source: "saas_signup",
        stage: "prospect",
        score: prospect.suggestedScore,
        notes: `Auto-discovered: ${prospect.transactionCount} transactions, ${prospect.companyCount} companies`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/pipeline"] });
      toast({ title: t["leadPipeline.prospectAddedToPipeline"] });
    },
    onError: () => toast({ title: translateNow("toasts.failedToAdd"), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            <T k="pages.autoDiscoveredSaasProspects" />
          </CardTitle>
          <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t["firmOps.prospectsHelp"]}</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t["firmOps.scanning"]}
          </div>
        ) : prospects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T k="pages.noHighActivityProspectsFoundRightNow" />
          </p>
        ) : (
          <div className="space-y-2">
            {prospects.map((p) => (
              <div
                key={p.userId}
                className="flex items-center justify-between bg-background border rounded-lg px-3 py-2 gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMessage(t["firmOps.prospectStats"], {
                      transactions: p.transactionCount,
                      companies: p.companyCount,
                      score: p.suggestedScore,
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => addMutation.mutate(p)}
                  disabled={addMutation.isPending}
                >
                  <UserPlus className="w-3.5 h-3.5 me-1" />
                  {t["firmOps.add"]}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LeadPipeline() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [showDiscover, setShowDiscover] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const draggingId = useRef<string | null>(null);

  const { data: pipeline, isLoading } = useQuery<PipelineData>({
    queryKey: ["/api/firm/pipeline"],
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: Stage }) =>
      apiRequest("PUT", `/api/firm/pipeline/leads/${id}`, { stage }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/firm/pipeline"] }),
    onError: () =>
      toast({ title: translateNow("toasts.failedToMoveLead"), variant: "destructive" }),
  });

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    draggingId.current = leadId;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, targetStage: Stage) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = draggingId.current;
    if (!id) return;
    draggingId.current = null;

    // Find the current stage of this lead
    const lead = pipeline?.leads.find((l) => l.id === id);
    if (!lead || lead.stage === targetStage) return;

    updateStageMutation.mutate({ id, stage: targetStage });
  };

  const handleDragOver = (e: React.DragEvent, stage: Stage) => {
    e.preventDefault();
    setDragOverStage(stage);
  };

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse space-y-4">
        <div className="h-10 w-48 rounded bg-muted" />
        <div className="flex gap-3">
          {STAGES.map((s) => (
            <div key={s.key} className="flex-1 min-w-[200px] h-64 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  const byStage = pipeline?.byStage ?? ({} as Record<Stage, Lead[]>);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firm"
        title={t["firmOps.pipelineTitle"]}
        description={
          <>
            {formatMessage(t["leadPipeline.leadsLeadsRateConversion"], {
              leads: pipeline?.totalLeads ?? 0,
              rate: pipeline?.conversionRate ?? 0,
            })}
            {pipeline?.avgDaysToConvert != null &&
              ` · ${formatMessage(t["leadPipeline.daysDAvgToConvert"], { days: pipeline.avgDaysToConvert })}`}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowDiscover((v) => !v)}>
              {t["leadPipeline.autoDiscover"]}
              {showDiscover ? (
                <ChevronUp className="w-3.5 h-3.5 ms-1" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 ms-1" />
              )}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 me-1.5" />
              <T k="pages.addLead" />
            </Button>
          </>
        }
      />

      {/* Auto-discover panel */}
      {showDiscover && <AutoDiscoverPanel onClose={() => setShowDiscover(false)} />}

      {/* Kanban board — horizontal scroll on small screens */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage.key}
            stage={stage}
            leads={byStage[stage.key] ?? []}
            onEdit={setEditLead}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragOver={dragOverStage === stage.key}
            onDragOver={(e) => handleDragOver(e, stage.key)}
            onDragLeave={() => setDragOverStage(null)}
          />
        ))}
      </div>

      {/* Dialogs */}
      <AddLeadDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <EditLeadDialog lead={editLead} onClose={() => setEditLead(null)} />
    </div>
  );
}
