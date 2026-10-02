import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeEntryDialog } from "@/components/projects/TimeEntryDialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TimeEntry } from "@/lib/purchasing-hr";
import { messages } from "@/pages/ProjectDetail.i18n";

interface Props {
  companyId: string;
  projectId: string;
  adding: boolean;
  onCloseAdd: () => void;
}

export function ProjectTimeTab({ companyId, projectId, adding, onCloseAdd }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  const { data: entries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/companies", companyId, "time-entries", projectId],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/time-entries?projectId=${projectId}&limit=200`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/time-entries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: tr("entryDeleted") });
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("entryDeleteFailed"), description: error?.message }),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" aria-label={tr("loading")} />;

  return (
    <>
      {entries.length === 0 ? (
        <EmptyState icon={Clock} title={tr("timeEmpty")} compact testId="empty-time" />
      ) : (
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colDate")}</TableHead>
                <TableHead>{tr("colWho")}</TableHead>
                <TableHead>{tr("colTask")}</TableHead>
                <TableHead>{tr("colNotes")}</TableHead>
                <TableHead className="text-end">{tr("colHours")}</TableHead>
                <TableHead>{tr("colBillable")}</TableHead>
                <TableHead>{tr("colStatus")}</TableHead>
                <TableHead className="text-end">{tr("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id} data-testid={`row-time-${e.id}`}>
                  <TableCell>{formatDate(e.entryDate, locale, CALENDAR_DATE_SHORT_FORMAT)}</TableCell>
                  <TableCell>{e.userName}</TableCell>
                  <TableCell>{e.taskName}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{e.notes}</TableCell>
                  <TableCell className="text-end tabular-nums">{e.running ? "-" : e.hours.toFixed(2)}</TableCell>
                  <TableCell>{e.isBillable ? tr("yes") : tr("no")}</TableCell>
                  <TableCell>
                    {e.running ? (
                      <StatusBadge tone="warning">{tr("runningNow")}</StatusBadge>
                    ) : e.billed ? (
                      <StatusBadge tone="success">{tr("billedOn", { number: e.billedInvoiceNumber ?? "" })}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">{tr("notBilled")}</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    {!e.billed && !e.running && (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(e)} aria-label={tr("editEntry")} data-testid={`button-edit-time-${e.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={tr("deleteEntry")}
                          onClick={() => window.confirm(tr("deleteEntryConfirm")) && remove.mutate(e.id)}
                          data-testid={`button-delete-time-${e.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <TimeEntryDialog companyId={companyId} projectId={projectId} open={adding || !!editing} entry={editing} onClose={() => { setEditing(null); onCloseAdd(); }} />
    </>
  );
}
