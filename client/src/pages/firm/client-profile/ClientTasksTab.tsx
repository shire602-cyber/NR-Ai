import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";
import { statusLabel } from "@/lib/status-label";
import { displayTaskTitle } from "../task-title";

interface FirmTask {
  id: string;
  title: string;
  dueDate: string;
  status: string;
}

const STATUS_TONE: Record<string, StatusTone> = {
  done: "success",
  in_progress: "info",
  open: "neutral",
  review: "warning",
  cancelled: "neutral",
};

/** Client profile > Tasks: the firm's recurring work for this client. */
export function ClientTasksTab({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useQuery<{ tasks: FirmTask[] }>({
    queryKey: [`/api/firm/tasks?companyId=${companyId}`],
  });
  const tasks = data?.tasks ?? [];

  return (
    <Card data-testid="client-tab-tasks">
      <CardHeader>
        <CardTitle className="text-base">{t["firmOps.clientTasksTitle"]}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : tasks.length === 0 ? (
          <EmptyState size="sm" title={t["firm.noTasks"]} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t["firm.task"]}</TableHead>
                <TableHead>{t["firm.dueDate"]}</TableHead>
                <TableHead>{t["firm.status"]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>{displayTaskTitle(task.title, t, locale)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(task.dueDate, locale)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_TONE[task.status] ?? "neutral"}>
                      {statusLabel(t, task.status)}
                    </StatusBadge>
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
