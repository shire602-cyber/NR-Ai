import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { splitDuration, type Project, type ProjectTask, type TimeEntry } from "@/lib/purchasing-hr";
import { messages } from "./TimerButton.i18n";

interface Props {
  companyId: string;
  /** Start straight on this project (the project page); without it a dialog asks which project. */
  projectId?: string;
}

const START_KEY = (entryId: string) => `muhasib.timer.start.${entryId}`;

/** When this browser started the timer; the server's own start time is the fallback (another device, cleared storage). */
function startMsOf(entry: TimeEntry): number {
  try {
    const stored = Number(window.localStorage.getItem(START_KEY(entry.id)));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    /* storage unavailable: use the server's time */
  }
  return entry.startedAt ? Date.parse(entry.startedAt) : Date.now();
}

const pad = (n: number) => String(n).padStart(2, "0");

export function TimerButton({ companyId, projectId }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const timerKey = ["/api/companies", companyId, "timer"];
  const [now, setNow] = useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickedProject, setPickedProject] = useState<string>("");
  const [pickedTask, setPickedTask] = useState<string>("none");
  const [notes, setNotes] = useState("");

  const { data } = useQuery<{ running: TimeEntry | null }>({ queryKey: timerKey, enabled: !!companyId, staleTime: 15_000 });
  const running = data?.running ?? null;

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/companies", companyId, "projects", "active-for-timer"],
    enabled: !!companyId && dialogOpen,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/projects?status=active`),
  });
  const chosenProject = projectId ?? pickedProject;
  const { data: tasks = [] } = useQuery<ProjectTask[]>({
    queryKey: ["/api/projects", chosenProject, "tasks"],
    enabled: dialogOpen && !!chosenProject,
  });

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: timerKey });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "time-entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
  };

  const start = useMutation({
    mutationFn: (body: { projectId: string; taskId?: string | null; notes?: string | null }) => apiRequest("POST", `/api/companies/${companyId}/timer/start`, body),
    onSuccess: (entry: TimeEntry) => {
      try {
        window.localStorage.setItem(START_KEY(entry.id), String(Date.now()));
      } catch {
        /* storage unavailable: the server's start time is used */
      }
      setDialogOpen(false);
      setNotes("");
      toast({ title: tr("started") });
      refresh();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("startFailed"), description: error?.message }),
  });

  const stop = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/timer/stop`, {}),
    onSuccess: (entry: TimeEntry) => {
      try {
        window.localStorage.removeItem(START_KEY(entry.id));
      } catch {
        /* nothing to clean */
      }
      const { hours, minutes } = splitDuration(entry.minutes);
      toast({ title: tr("stopped"), description: tr("stoppedBody", { duration: tr("hoursShort", { h: hours, m: minutes }) }) });
      refresh();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("stopFailed"), description: error?.message }),
  });

  const onStartClick = () => {
    if (projectId) start.mutate({ projectId });
    else setDialogOpen(true);
  };

  if (running) {
    const totalSeconds = Math.max(0, Math.floor((now - startMsOf(running)) / 1000));
    const clock = `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 ps-3 pe-1 py-1" data-testid="timer-running">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
        <Link href={`/projects/${running.projectId}`} className="text-sm hover:underline" title={tr("running", { project: running.projectName })}>
          {running.projectCode}
        </Link>
        <span className="font-mono text-sm tabular-nums" dir="ltr" data-testid="text-timer-elapsed">
          {clock}
        </span>
        <Button size="sm" variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending} data-testid="button-stop-timer">
          {stop.isPending ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Square className="h-4 w-4 me-1" />}
          {tr("stop")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={onStartClick} disabled={start.isPending} data-testid="button-start-timer">
        {start.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Play className="h-4 w-4 me-2" />}
        {tr("start")}
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{tr("startTitle")}</DialogTitle>
            <DialogDescription>{tr("startBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{tr("project")}</Label>
              <Select value={pickedProject} onValueChange={(v) => { setPickedProject(v); setPickedTask("none"); }}>
                <SelectTrigger data-testid="select-timer-project">
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
              {projects.length === 0 && <p className="text-xs text-muted-foreground">{tr("noProjects")}</p>}
            </div>
            {tasks.length > 0 && (
              <div className="space-y-1">
                <Label>{tr("task")}</Label>
                <Select value={pickedTask} onValueChange={setPickedTask}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tr("noTask")}</SelectItem>
                    {tasks.filter((t) => t.status === "open").map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tr("notes")} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              disabled={!pickedProject || start.isPending}
              onClick={() => start.mutate({ projectId: pickedProject, taskId: pickedTask === "none" ? null : pickedTask, notes: notes.trim() || null })}
              data-testid="button-begin-timer"
            >
              {tr("begin")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
