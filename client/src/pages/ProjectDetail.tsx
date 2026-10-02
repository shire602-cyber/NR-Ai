import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Briefcase, Clock, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { ProjectProfitabilityTab } from "@/components/projects/ProjectProfitabilityTab";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ProjectTasksTab } from "@/components/projects/ProjectTasksTab";
import { ProjectTimeTab } from "@/components/projects/ProjectTimeTab";
import { ProjectUnbilledTab } from "@/components/projects/ProjectUnbilledTab";
import { TimerButton } from "@/components/projects/TimerButton";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import type { Project } from "@/lib/purchasing-hr";
import { messages } from "./ProjectDetail.i18n";

export default function ProjectDetail() {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const [, params] = useRoute("/projects/:id");
  const projectId = params?.id ?? "";
  const [editing, setEditing] = useState(false);
  const [addingTime, setAddingTime] = useState(false);

  const { data: project, isLoading, isError, error } = useQuery<Project>({ queryKey: ["/api/projects", projectId], enabled: !!projectId });

  if (isLoading) return <div className="p-6"><Skeleton className="h-64 w-full" aria-label={tr("loading")} /></div>;
  if (isError || !project) {
    const missing = (error as { status?: number } | null)?.status === 404;
    return (
      <div className="p-6">
        <PageHeader eyebrow={tr("eyebrow")} title={tr("back")} backHref="/projects" backLabel={tr("back")} />
        <p className="mt-4 text-sm text-destructive" role="alert">{missing ? tr("notFound") : tr("loadFailed")}</p>
      </div>
    );
  }

  const displayName = locale === "ar" && project.nameAr ? project.nameAr : project.name;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-project-detail">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={`${project.code} - ${displayName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <span>{project.contactName ?? tr("noCustomer")}</span>
          </span>
        }
        icon={Briefcase}
        backHref="/projects"
        backLabel={tr("back")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {companyId && <TimerButton companyId={companyId} projectId={project.id} />}
            <Button variant="outline" onClick={() => setAddingTime(true)} data-testid="button-project-add-time">
              <Clock className="h-4 w-4 me-2" />
              {tr("addTime")}
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-project">
              <Pencil className="h-4 w-4 me-2" />
              {tr("edit")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="time">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="time" data-testid="tab-project-time">{tr("tabTime")}</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-project-tasks">{tr("tabTasks")}</TabsTrigger>
          <TabsTrigger value="unbilled" data-testid="tab-project-unbilled">{tr("tabUnbilled")}</TabsTrigger>
          <TabsTrigger value="profit" data-testid="tab-project-profit">{tr("tabProfit")}</TabsTrigger>
        </TabsList>
        <TabsContent value="time">
          {companyId && <ProjectTimeTab companyId={companyId} projectId={project.id} adding={addingTime} onCloseAdd={() => setAddingTime(false)} />}
        </TabsContent>
        <TabsContent value="tasks">
          <ProjectTasksTab projectId={project.id} currency={project.currency} />
        </TabsContent>
        <TabsContent value="unbilled">
          <ProjectUnbilledTab project={project} />
        </TabsContent>
        <TabsContent value="profit">
          <ProjectProfitabilityTab project={project} />
        </TabsContent>
      </Tabs>

      {companyId && <ProjectFormDialog companyId={companyId} open={editing} project={project} onClose={() => setEditing(false)} />}
    </div>
  );
}
