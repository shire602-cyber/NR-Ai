import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Plus,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  UserPlus,
  MoreHorizontal,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useTranslation } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 'prospect' | 'contacted' | 'interested' | 'converted' | 'lost';
type Source = 'saas_signup' | 'referral' | 'manual' | 'website';

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
  { key: 'prospect', label: 'Prospect', color: 'text-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200' },
  { key: 'contacted', label: 'Contacted', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200' },
  { key: 'interested', label: 'Interested', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200' },
  { key: 'converted', label: 'Converted', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20 border-green-200' },
  { key: 'lost', label: 'Lost', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200' },
];

const SCORE_COLOR = (score: number) => {
  if (score >= 70) return 'bg-green-100 text-green-800 border-green-200';
  if (score >= 40) return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-red-100 text-red-800 border-red-200';
};

const SOURCE_LABELS: Record<Source, string> = {
  saas_signup: 'SaaS',
  referral: 'Referral',
  manual: 'Manual',
  website: 'Website',
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
      onDragStart={e => onDragStart(e, lead.id)}
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
          <Badge className={`text-xs px-1.5 py-0 border ${SCORE_COLOR(lead.score)}`}>
            {lead.score}
          </Badge>
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
          {SOURCE_LABELS[lead.source]}
        </Badge>
      </div>

      {lead.notes && (
        <p className="text-xs text-muted-foreground line-clamp-2">{lead.notes}</p>
      )}
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
  stage: typeof STAGES[0];
  leads: Lead[];
  onEdit: (lead: Lead) => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  onDrop: (e: React.DragEvent, targetStage: Stage) => void;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  return (
    <div
      className={`flex flex-col min-w-[220px] flex-1 rounded-xl border ${stage.bg} transition-colors ${isDragOver ? 'ring-2 ring-primary ring-offset-1' : ''}`}
      onDragOver={onDragOver}
      onDrop={e => onDrop(e, stage.key)}
      onDragLeave={onDragLeave}
    >
      <div className="px-3 py-2.5 border-b flex items-center justify-between">
        <span className={`text-sm font-semibold ${stage.color}`}>{stage.label}</span>
        <Badge variant="secondary" className="text-xs">{leads.length}</Badge>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
        {leads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onEdit={onEdit}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Add Lead dialog ──────────────────────────────────────────────────────────

function AddLeadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [userId, setUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [score, setScore] = useState('50');
  const [source, setSource] = useState<Source>('manual');
  const [stage, setStage] = useState<Stage>('prospect');

  const mutation = useMutation({
    mutationFn: (data: object) => apiRequest('POST', '/api/firm/pipeline/leads', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/pipeline'] });
      toast({ title: 'Lead added' });
      onClose();
      setUserId(''); setNotes(''); setScore('50');
    },
    onError: () => toast({ title: 'Failed to add lead', variant: 'destructive' }),
  });

  const handleSubmit = () => {
    if (!userId.trim()) return;
    mutation.mutate({ userId: userId.trim(), notes: notes || undefined, score: Number(score), source, stage });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>User ID (UUID)</Label>
            <Input
              placeholder="e.g. 550e8400-e29b-41d4-..."
              value={userId}
              onChange={e => setUserId(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={stage} onValueChange={v => setStage(v as Stage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={source} onValueChange={v => setSource(v as Source)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="saas_signup">SaaS Signup</SelectItem>
                  <SelectItem value="referral">Referral</SelectItem>
                  <SelectItem value="website">Website</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Score (0–100)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={e => setScore(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              placeholder="Optional notes..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending || !userId.trim()}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Add Lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Lead dialog ─────────────────────────────────────────────────────────

function EditLeadDialog({
  lead,
  onClose,
}: {
  lead: Lead | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(lead?.notes ?? '');
  const [score, setScore] = useState(String(lead?.score ?? 50));
  const [stage, setStage] = useState<Stage>(lead?.stage ?? 'prospect');

  const updateMutation = useMutation({
    mutationFn: (data: object) =>
      apiRequest('PUT', `/api/firm/pipeline/leads/${lead!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/pipeline'] });
      toast({ title: 'Lead updated' });
      onClose();
    },
    onError: () => toast({ title: 'Failed to update', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', `/api/firm/pipeline/leads/${lead!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/pipeline'] });
      toast({ title: 'Lead removed' });
      onClose();
    },
    onError: () => toast({ title: 'Failed to delete', variant: 'destructive' }),
  });

  if (!lead) return null;

  return (
    <Dialog open={!!lead} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Lead — {lead.userEmail}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-sm text-muted-foreground space-y-0.5">
            {lead.companyName && <p>Company: {lead.companyName}</p>}
            <p>Source: {SOURCE_LABELS[lead.source]}</p>
            <p>Added: {new Date(lead.createdAt).toLocaleDateString()}</p>
            {lead.convertedAt && (
              <p>Converted: {new Date(lead.convertedAt).toLocaleDateString()}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={stage} onValueChange={v => setStage(v as Stage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map(s => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Score (0–100)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={e => setScore(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate({ stage, notes: notes || null, score: Number(score) })}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Auto-discover panel ──────────────────────────────────────────────────────

function AutoDiscoverPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();

  const { data: prospects = [], isLoading } = useQuery<SaasProspect[]>({
    queryKey: ['/api/firm/pipeline/saas-prospects'],
  });

  const addMutation = useMutation({
    mutationFn: (prospect: SaasProspect) =>
      apiRequest('POST', '/api/firm/pipeline/leads', {
        userId: prospect.userId,
        source: 'saas_signup',
        stage: 'prospect',
        score: prospect.suggestedScore,
        notes: `Auto-discovered: ${prospect.transactionCount} transactions, ${prospect.companyCount} companies`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/pipeline'] });
      toast({ title: 'Prospect added to pipeline' });
    },
    onError: () => toast({ title: 'Failed to add', variant: 'destructive' }),
  });

  return (
    <Card className="border-amber-200 bg-amber-50/40 dark:bg-amber-900/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
            <Sparkles className="w-4 h-4" />
            Auto-discovered SaaS Prospects
          </CardTitle>
          <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Active SaaS users with 30+ transactions in the last 30 days — potential NRA clients.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Scanning…
          </div>
        ) : prospects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No high-activity prospects found right now.</p>
        ) : (
          <div className="space-y-2">
            {prospects.map(p => (
              <div
                key={p.userId}
                className="flex items-center justify-between bg-background border rounded-lg px-3 py-2 gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.transactionCount} txns · {p.companyCount} companies · score {p.suggestedScore}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => addMutation.mutate(p)}
                  disabled={addMutation.isPending}
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1" />
                  Add
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
    queryKey: ['/api/firm/pipeline'],
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: Stage }) =>
      apiRequest('PUT', `/api/firm/pipeline/leads/${id}`, { stage }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/firm/pipeline'] }),
    onError: () => toast({ title: 'Failed to move lead', variant: 'destructive' }),
  });

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    draggingId.current = leadId;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetStage: Stage) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = draggingId.current;
    if (!id) return;
    draggingId.current = null;

    // Find the current stage of this lead
    const lead = pipeline?.leads.find(l => l.id === id);
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
          {STAGES.map(s => (
            <div key={s.key} className="flex-1 min-w-[200px] h-64 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  const byStage = pipeline?.byStage ?? ({} as Record<Stage, Lead[]>);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{(t as any).leadPipeline || 'Lead Pipeline'}</h1>
          <p className="text-sm text-muted-foreground">
            {pipeline?.totalLeads ?? 0} leads · {pipeline?.conversionRate ?? 0}% conversion
            {pipeline?.avgDaysToConvert != null && ` · ${pipeline.avgDaysToConvert}d avg to convert`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDiscover(v => !v)}
          >
            <Sparkles className="w-4 h-4 mr-1.5 text-amber-500" />
            Auto-discover
            {showDiscover ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add Lead
          </Button>
        </div>
      </div>

      {/* Auto-discover panel */}
      {showDiscover && (
        <AutoDiscoverPanel onClose={() => setShowDiscover(false)} />
      )}

      {/* Kanban board — horizontal scroll on small screens */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STAGES.map(stage => (
          <KanbanColumn
            key={stage.key}
            stage={stage}
            leads={byStage[stage.key] ?? []}
            onEdit={setEditLead}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDragOver={dragOverStage === stage.key}
            onDragOver={e => handleDragOver(e, stage.key)}
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
