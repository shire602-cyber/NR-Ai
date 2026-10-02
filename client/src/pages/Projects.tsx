import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Briefcase, Clock, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { TimerButton } from "@/components/projects/TimerButton";
import { TimeEntryDialog } from "@/components/projects/TimeEntryDialog";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@/lib/purchasing-hr";
import { messages } from "./Projects.i18n";

type Filter = "all" | Project["status"];

export default function Projects() {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { canAccess, getRequiredTier, isLoading: subLoading } = useSubscription();
  const [status, setStatus] = useState<Filter>("active");
  const [creating, setCreating] = useState(false);
  const [addingTime, setAddingTime] = useState(false);
  const allowed = canAccess("projects");

  const { data: projects = [], isLoading, isError } = useQuery<Project[]>({
    queryKey: ["/api/companies", companyId, "projects", status],
    enabled: !!companyId && allowed,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/projects?status=${status}`),
  });

  if (!subLoading && !allowed) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} icon={Briefcase} />
        <UpgradePrompt feature="projects" requiredTier={getRequiredTier("projects")} title={tr("upgradeTitle")} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-projects">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={tr("title")}
        description={tr("description")}
        icon={Briefcase}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {companyId && <TimerButton companyId={companyId} />}
            <Button variant="outline" onClick={() => setAddingTime(true)} data-testid="button-add-time">
              <Clock className="h-4 w-4 me-2" />
              {tr("addTime")}
            </Button>
            <Button onClick={() => setCreating(true)} data-testid="button-new-project">
              <Plus className="h-4 w-4 me-2" />
              {tr("newProject")}
            </Button>
          </div>
        }
      />

      <div className="space-y-1 max-w-[220px]">
        <Label>{tr("filterStatus")}</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as Filter)}>
          <SelectTrigger data-testid="select-project-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{tr("statusActive")}</SelectItem>
            <SelectItem value="on_hold">{tr("statusOnHold")}</SelectItem>
            <SelectItem value="completed">{tr("statusCompleted")}</SelectItem>
            <SelectItem value="cancelled">{tr("statusCancelled")}</SelectItem>
            <SelectItem value="all">{tr("statusAll")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" aria-label={tr("loading")} />
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={tr("emptyTitle")}
          description={tr("emptyBody")}
          action={{ label: tr("newProject"), onClick: () => setCreating(true), icon: Plus, testId: "button-empty-new-project" }}
          testId="empty-projects"
        />
      ) : (
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colCode")}</TableHead>
                <TableHead>{tr("colName")}</TableHead>
                <TableHead>{tr("colCustomer")}</TableHead>
                <TableHead>{tr("colStatus")}</TableHead>
                <TableHead className="text-end">{tr("colRate")}</TableHead>
                <TableHead className="text-end">{tr("colBudget")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id} data-testid={`row-project-${p.id}`}>
                  <TableCell className="font-mono text-sm" dir="ltr">{p.code}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/projects/${p.id}`} className="hover:underline" data-testid={`link-project-${p.id}`}>
                      {locale === "ar" && p.nameAr ? p.nameAr : p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.contactName ?? <span className="text-muted-foreground">{tr("noCustomer")}</span>}</TableCell>
                  <TableCell>
                    <ProjectStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {p.billingMethod === "non_billable" || p.hourlyRate === null ? <span className="text-muted-foreground">{tr("notBillable")}</span> : formatCurrency(p.hourlyRate, p.currency, locale)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {p.budgetAmount === null ? <span className="text-muted-foreground">{tr("noBudget")}</span> : formatCurrency(p.budgetAmount, "AED", locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {companyId && <ProjectFormDialog companyId={companyId} open={creating} project={null} onClose={() => setCreating(false)} />}
      {companyId && <TimeEntryDialog companyId={companyId} open={addingTime} entry={null} onClose={() => setAddingTime(false)} />}
    </div>
  );
}
