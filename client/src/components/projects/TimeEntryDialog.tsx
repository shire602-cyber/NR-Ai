import { useEffect, useState } from "react";
import { todayYmd as today } from "@/lib/calendar-date";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseDurationInput, splitDuration, type Project, type ProjectTask, type TimeEntry } from "@/lib/purchasing-hr";
import { messages } from "./TimeEntryDialog.i18n";

interface Props {
  companyId: string;
  open: boolean;
  /** Fixed project (the project page); without it the dialog asks. */
  projectId?: string;
  entry: TimeEntry | null;
  onClose: () => void;
}

const NONE = "none";
const durationText = (minutes: number) => {
  const { hours, minutes: m } = splitDuration(minutes);
  return `${hours}:${String(m).padStart(2, "0")}`;
};

export function TimeEntryDialog({ companyId, open, projectId, entry, onClose }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [project, setProject] = useState("");
  const [task, setTask] = useState(NONE);
  const [date, setDate] = useState(today());
  const [duration, setDuration] = useState("");
  const [billable, setBillable] = useState(true);
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProject(entry?.projectId ?? projectId ?? "");
    setTask(entry?.taskId ?? NONE);
    setDate(entry?.entryDate ?? today());
    setDuration(entry ? durationText(entry.minutes) : "");
    setBillable(entry?.isBillable ?? true);
    setRate(entry?.rate === null || entry?.rate === undefined ? "" : String(entry.rate));
    setNotes(entry?.notes ?? "");
    setProblem(null);
  }, [open, entry, projectId]);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/companies", companyId, "projects", "active-for-timer"],
    enabled: open && !projectId && !entry,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/projects?status=active`),
  });
  const { data: tasks = [] } = useQuery<ProjectTask[]>({ queryKey: ["/api/projects", project, "tasks"], enabled: open && !!project });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      entry ? apiRequest("PATCH", `/api/time-entries/${entry.id}`, body) : apiRequest("POST", `/api/companies/${companyId}/time-entries`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: tr("saved") });
      onClose();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("saveFailed"), description: error?.message }),
  });

  const submit = () => {
    const minutes = parseDurationInput(duration);
    if (!project) return setProblem(tr("projectRequired"));
    if (!date) return setProblem(tr("dateRequired"));
    if (minutes === null) return setProblem(tr("durationInvalid"));
    setProblem(null);
    save.mutate({
      ...(entry ? {} : { projectId: project }),
      taskId: task === NONE ? null : task,
      entryDate: date,
      minutes,
      isBillable: billable,
      rate: rate.trim() === "" ? null : Number(rate),
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{entry ? tr("titleEdit") : tr("titleNew")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!projectId && !entry && (
            <div className="space-y-1">
              <Label>{tr("project")}</Label>
              <Select value={project} onValueChange={(v) => { setProject(v); setTask(NONE); }}>
                <SelectTrigger data-testid="select-entry-project">
                  <SelectValue placeholder={tr("chooseProject")} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} - {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {tasks.length > 0 && (
            <div className="space-y-1">
              <Label>{tr("task")}</Label>
              <Select value={task} onValueChange={setTask}>
                <SelectTrigger data-testid="select-entry-task">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{tr("noTask")}</SelectItem>
                  {tasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="entry-date">{tr("date")}</Label>
              <Input id="entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-entry-date" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entry-duration">{tr("duration")}</Label>
              <Input id="entry-duration" dir="ltr" value={duration} placeholder={tr("durationPlaceholder")} onChange={(e) => setDuration(e.target.value)} data-testid="input-entry-duration" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="entry-billable">{tr("billable")}</Label>
            <Switch id="entry-billable" checked={billable} onCheckedChange={setBillable} data-testid="switch-entry-billable" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry-rate">{tr("rate")}</Label>
            <Input id="entry-rate" type="number" min={0} step="0.01" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} />
            <p className="text-xs text-muted-foreground">{tr("rateHint")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry-notes">{tr("notes")}</Label>
            <Textarea id="entry-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("cancel")}
          </Button>
          <Button onClick={submit} disabled={save.isPending} data-testid="button-save-entry">
            {save.isPending ? (
              <>
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
                {tr("saving")}
              </>
            ) : (
              tr("save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
