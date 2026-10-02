import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ProjectTask } from "@/lib/purchasing-hr";
import { messages } from "@/pages/ProjectDetail.i18n";

export function ProjectTasksTab({ projectId, currency }: { projectId: string; currency: string }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [billable, setBillable] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const key = ["/api/projects", projectId, "tasks"];
  const { data: tasks = [], isLoading } = useQuery<ProjectTask[]>({ queryKey: key });

  const done = () => queryClient.invalidateQueries({ queryKey: key });
  const failed = (error: any) => toast({ variant: "destructive", title: tr("taskFailed"), description: error?.message });

  const add = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/tasks`, { name: name.trim(), hourlyRate: rate.trim() === "" ? null : Number(rate), isBillable: billable }),
    onSuccess: () => {
      setName("");
      setRate("");
      setBillable(true);
      toast({ title: tr("taskAdded") });
      done();
    },
    onError: failed,
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "done" }) => apiRequest("PATCH", `/api/project-tasks/${id}`, { status }),
    onSuccess: done,
    onError: failed,
  });
  const remove = useMutation({ mutationFn: (id: string) => apiRequest("DELETE", `/api/project-tasks/${id}`), onSuccess: done, onError: failed });

  const submit = () => {
    if (!name.trim()) return setProblem(tr("taskNameRequired"));
    setProblem(null);
    add.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
        <div className="space-y-1 flex-1 min-w-[200px]">
          <Label htmlFor="task-name">{tr("taskName")}</Label>
          <Input id="task-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-task-name" />
        </div>
        <div className="space-y-1 w-40">
          <Label htmlFor="task-rate">{tr("taskRate")}</Label>
          <Input id="task-rate" type="number" min={0} step="0.01" dir="ltr" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="task-billable" checked={billable} onCheckedChange={setBillable} />
          <Label htmlFor="task-billable">{tr("taskBillable")}</Label>
        </div>
        <Button onClick={submit} disabled={add.isPending} data-testid="button-add-task">
          <Plus className="h-4 w-4 me-2" />
          {tr("addTask")}
        </Button>
        {problem && <p className="basis-full text-sm text-destructive" role="alert">{problem}</p>}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" aria-label={tr("loading")} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title={tr("tasksEmpty")} compact testId="empty-tasks" />
      ) : (
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colTask")}</TableHead>
                <TableHead className="text-end">{tr("colRate")}</TableHead>
                <TableHead>{tr("colBillable")}</TableHead>
                <TableHead>{tr("colStatus")}</TableHead>
                <TableHead className="text-end">{tr("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id} data-testid={`row-task-${t.id}`}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-end tabular-nums">{t.hourlyRate === null ? "-" : formatCurrency(t.hourlyRate, currency, locale)}</TableCell>
                  <TableCell>{t.isBillable ? tr("yes") : tr("no")}</TableCell>
                  <TableCell>
                    <StatusBadge tone={t.status === "done" ? "success" : "info"}>{t.status === "done" ? tr("taskDone") : tr("taskOpen")}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-end space-x-1 rtl:space-x-reverse">
                    <Button size="sm" variant="outline" onClick={() => update.mutate({ id: t.id, status: t.status === "done" ? "open" : "done" })}>
                      {t.status === "done" ? tr("reopen") : tr("markDone")}
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={tr("deleteTask")} onClick={() => remove.mutate(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
