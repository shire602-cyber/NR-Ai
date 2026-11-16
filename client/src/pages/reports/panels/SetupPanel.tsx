// Reports > setup workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { ArrowRight, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { SiGooglesheets } from "react-icons/si";
import { T } from "@/components/layout/T";
import {
  productDepthEvidenceCheckpointStatusMeta,
  productDepthStatusMeta,
  roadmapImpactMeta,
} from "../shared";
import {
  reportAutomationPlaybookHref,
  reportCatalog,
  reportPersonaHref,
  reportSectionHref,
  reportWorkspaceHref,
} from "@/lib/reportCatalog";
import { useReportsPageContext } from "../context";

export default function SetupPanel() {
  const {
    handleExportWorkspacePack,
    handleExportWorkspacePackToSheets,
    isExporting,
    navigate,
    personaScopeDescription,
    reportWorkspacePanelClass,
    selectedCompanyId,
    setReportPersonaFilter,
    visiblePlannedReportCount,
    visibleReportProductDepthAreas,
    visibleReportProductDepthSubgoalCount,
    visibleReportRoadmap,
    visibleWorkspaceSummaries,
  } = useReportsPageContext();
  return (
    <>
      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-role-setup-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-role-setup-title" className="text-xl font-semibold">
              <T k="reportCenter.roleSetupPaths" />
            </h2>
            <p className="text-sm text-muted-foreground">
              First-run checklists for owners, solo entrepreneurs, freelancers, and accountants to
              move from report review into automated delivery. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="outline">
            {visibleWorkspaceSummaries.reduce(
              (total, workspace) => total + workspace.setupStepCount,
              0
            )}{" "}
            steps
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => (
            <Card key={workspace.persona} data-testid={`report-role-setup-${workspace.persona}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">{workspace.navLabel}</CardTitle>
                    <CardDescription>{workspace.automationOutcome}</CardDescription>
                  </div>
                  <Badge variant="info">{workspace.setupStepCount} steps</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {workspace.setupChecklist.map((step, index) => (
                  <Link key={step.id} href={step.href}>
                    <div
                      className="rounded-md border p-3 transition-colors hover:bg-muted/5"
                      data-testid={`report-role-setup-step-${step.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{step.title}</div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {step.outcome}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge variant="outline">{step.reports.length} reports</Badge>
                            <Badge variant="outline">{step.command}</Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-role-workflows-title"
        data-testid="report-role-workflows"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-role-workflows-title" className="text-xl font-semibold">
              <T k="reportCenter.roleWorkflowChecklist" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Recurring report routines for owner, freelancer, and accountant workspaces after the
              first setup path is complete. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info">
            {visibleWorkspaceSummaries.reduce(
              (total, workspace) => total + workspace.workflowStepCount,
              0
            )}{" "}
            workflows
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => {
            const WorkspaceIcon = workspace.icon;

            return (
              <Card
                key={workspace.persona}
                data-testid={`report-role-workflows-${workspace.persona}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">
                          {workspace.navLabel}
                        </CardTitle>
                        <CardDescription>{workspace.focus}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline">{workspace.workflowStepCount} workflows</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {workspace.workflowSteps.map((step, index) => (
                    <div
                      key={step.id}
                      id={`report-role-workflow-step-${step.id}`}
                      className="rounded-md border p-3"
                      data-testid={`report-role-workflow-step-${step.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">
                                {step.title}
                              </div>
                              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {step.outcome}
                              </div>
                            </div>
                            <Badge variant="neutral">{step.cadence}</Badge>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline">{step.reports.length} reports</Badge>
                            {step.reportSuite ? (
                              <Badge variant="outline">{step.reportSuite.workflow}</Badge>
                            ) : null}
                            {step.savedView ? (
                              <Badge variant="outline">{step.savedView.dateRangePreset}</Badge>
                            ) : null}
                          </div>

                          <div
                            className="grid grid-cols-1 gap-2 rounded-md bg-secondary/30 p-2 text-xs md:grid-cols-2"
                            data-testid={`report-role-workflow-defaults-${step.id}`}
                          >
                            <div>
                              <div className="font-medium text-foreground">
                                <T k="reportCenter.defaultView" />
                              </div>
                              <Link
                                href={step.defaultViewHref}
                                className="mt-1 block text-muted-foreground hover:text-primary"
                              >
                                {step.defaultViewLabel}
                              </Link>
                            </div>
                            <div>
                              <div className="font-medium text-foreground">
                                <T k="reportCenter.handoffGuardrail" />
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {step.handoffGuardrail}
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                Recipients: {step.handoffRecipients}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm">
                              <Link href={step.href}>
                                {step.primaryAction} <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href={step.automationHref}>
                                <T k="reportCenter.openAutomation" />
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href={step.deliveryHref}>
                                <T k="reportCenter.openDelivery" />
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-product-depth-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-product-depth-title" className="text-xl font-semibold">
              <T k="reportCenter.reportingWorkflowMap" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Open the reporting work that is ready, being hardened, or waiting on deeper accounting
              evidence. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot data-testid="report-product-depth-count">
            {visibleReportProductDepthSubgoalCount} subgoals
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {visibleReportProductDepthAreas.map((area) => {
            const areaStatus = productDepthStatusMeta[area.status];

            return (
              <Card
                key={area.id}
                id={`report-product-depth-${area.id}`}
                data-testid={`report-product-depth-${area.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold">{area.title}</CardTitle>
                      <CardDescription>{area.objective}</CardDescription>
                    </div>
                    <Badge variant={areaStatus.variant} dot>
                      {areaStatus.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {area.subgoals.map((subgoal) => {
                    const subgoalStatus = productDepthStatusMeta[subgoal.status];

                    return (
                      <div
                        key={subgoal.id}
                        id={`report-product-depth-subgoal-${subgoal.id}`}
                        data-testid={`report-product-depth-subgoal-${subgoal.id}`}
                        className="rounded-md border p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium">{subgoal.title}</div>
                              <Badge variant={subgoalStatus.variant} dot>
                                {subgoalStatus.label}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{subgoal.outcome}</p>
                            <div className="text-xs text-muted-foreground">{subgoal.evidence}</div>
                            {subgoal.dataDependency ? (
                              <div className="rounded-md bg-secondary/40 p-2 text-xs text-muted-foreground">
                                {subgoal.dataDependency}
                              </div>
                            ) : null}
                          </div>
                          <Button asChild size="sm" variant="outline">
                            <Link href={subgoal.href}>
                              <T k="reportCenter.openWorkflow" />
                            </Link>
                          </Button>
                        </div>

                        {subgoal.sourceDrilldownTargets?.length ? (
                          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {subgoal.sourceDrilldownTargets.map((target) => (
                              <div
                                key={target.id}
                                data-testid={`report-source-drilldown-target-${target.id}`}
                                className="rounded-md border bg-secondary/20 p-3"
                              >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium">{target.title}</div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {target.availableEvidence}
                                    </p>
                                  </div>
                                  <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                    className="h-7 shrink-0 px-2"
                                  >
                                    <Link href={target.href}>
                                      <T k="reportCenter.openTarget" />
                                    </Link>
                                  </Button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <Badge variant="outline">{target.reportIds.length} reports</Badge>
                                  {target.sourceEntities.slice(0, 3).map((entity) => (
                                    <Badge key={entity} variant="neutral">
                                      {entity}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="mt-2 rounded-md bg-background/60 p-2 text-xs text-muted-foreground">
                                  {target.universalLinkGap}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {subgoal.evidenceCheckpoints?.length ? (
                          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
                            {subgoal.evidenceCheckpoints.map((checkpoint) => {
                              const checkpointStatus =
                                productDepthEvidenceCheckpointStatusMeta[checkpoint.status];

                              return (
                                <div
                                  key={checkpoint.id}
                                  data-testid={`report-evidence-checkpoint-${checkpoint.id}`}
                                  className="rounded-md border bg-secondary/20 p-2"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-xs font-medium">{checkpoint.label}</div>
                                    <Badge variant={checkpointStatus.variant} dot>
                                      {checkpointStatus.label}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {checkpoint.detail}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {subgoal.requiredSourceRecords?.length ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">
                              <T k="reportCenter.requiredSourceRecords" />
                            </div>
                            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                              {subgoal.requiredSourceRecords.map((record) => (
                                <div
                                  key={record.id}
                                  className="rounded-md border p-2 text-xs"
                                  data-testid={`report-required-source-record-${record.id}`}
                                >
                                  <div className="font-medium text-foreground">{record.label}</div>
                                  <div className="mt-1 text-muted-foreground">
                                    {record.systemOfRecord}
                                  </div>
                                  <div className="mt-2 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                                    Unlocks: {record.unlocks}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-1">
                          <Badge variant="outline">{subgoal.reportIds.length} reports</Badge>
                          <Badge variant="outline">
                            {subgoal.comparisonPresetIds.length} comparisons
                          </Badge>
                          <Badge variant="outline">
                            {subgoal.automationStarterIds.length} automations
                          </Badge>
                          <Badge variant="outline">
                            {subgoal.deliverySubscriptionIds.length} deliveries
                          </Badge>
                          <Badge variant="outline">
                            {subgoal.decisionShortcutIds.length} questions
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-muted-foreground">
                            Next: {subgoal.nextAction}
                          </div>
                          <Button asChild size="sm" variant="ghost" className="justify-start">
                            <Link href={area.href}>
                              <T k="reportCenter.openHeader" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-roadmap-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-roadmap-title" className="text-xl font-semibold">
              <T k="reportCenter.reportRoadmap" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Planned report gaps by role, with the automation unlocks each workspace gains next.{" "}
              {personaScopeDescription}
            </p>
          </div>
          <Badge variant={visiblePlannedReportCount > 0 ? "warning" : "success"} dot>
            {visiblePlannedReportCount} planned
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportRoadmap.map((item) => {
            const workspace = item.workspace;
            const WorkspaceIcon = workspace.icon;

            return (
              <Card key={workspace.persona} data-testid={`report-roadmap-${workspace.persona}`}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.focus}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={item.plannedReportCount > 0 ? "warning" : "success"} dot>
                      {item.roadmapStatus}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.liveNow" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {item.liveReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.planned" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {item.plannedReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.categories" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {item.plannedCategories.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.prereqs" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {item.prerequisiteCount}
                      </div>
                    </div>
                  </div>

                  {item.topPriorityReport ? (
                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">
                            <T k="reportCenter.topRoadmapPriority" />
                          </div>
                          <div className="mt-1 text-sm font-medium">
                            {item.topPriorityReport.name}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="warning">{item.topPriorityScore}</Badge>
                          {item.topPriorityImpact ? (
                            <Badge variant={roadmapImpactMeta[item.topPriorityImpact].variant} dot>
                              {roadmapImpactMeta[item.topPriorityImpact].label}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {item.topPriorityReport.roadmapPriority?.rationale}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.nextReportUnlocks" />
                    </div>
                    {item.nextReports.length > 0 ? (
                      item.nextReports.map((report) => {
                        const impact = report.roadmapPriority?.impactByPersona[workspace.persona];
                        return (
                          <div
                            key={report.id}
                            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium">{report.name}</div>
                                <Badge variant="outline">{report.category}</Badge>
                                {typeof report.roadmapPriority?.score === "number" ? (
                                  <Badge variant="warning">{report.roadmapPriority.score}</Badge>
                                ) : null}
                                {impact ? (
                                  <Badge variant={roadmapImpactMeta[impact].variant} dot>
                                    {roadmapImpactMeta[impact].label}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {report.comparison} - {report.automation}
                              </div>
                              {report.roadmapPriority?.rationale ? (
                                <div className="text-xs text-muted-foreground">
                                  {report.roadmapPriority.rationale}
                                </div>
                              ) : null}
                              {report.roadmapPrerequisites ? (
                                <div className="grid gap-2 pt-2 text-xs text-muted-foreground">
                                  <div>
                                    <span className="font-medium text-foreground">
                                      Data source:
                                    </span>{" "}
                                    {report.roadmapPrerequisites.dataSource}
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground">
                                      Workflow dependency:
                                    </span>{" "}
                                    {report.roadmapPrerequisites.workflowDependency}
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground">
                                      Automation rule:
                                    </span>{" "}
                                    {report.roadmapPrerequisites.automationRule}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={
                                  reportPersonaHref(report, workspace.persona) ??
                                  reportWorkspaceHref(workspace)
                                }
                              >
                                <T k="reportCenter.openArea" />
                              </Link>
                            </Button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-md border p-3 text-sm text-muted-foreground">
                        <T k="reportCenter.allTargetReportsForThisWorkspaceAre" />
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.automationUnlocks" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.plannedAutomationHooks.length > 0
                        ? item.plannedAutomationHooks
                        : ["No planned automation gaps"]
                      ).map((hook) => (
                        <Badge key={hook} variant="outline">
                          {hook}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.workflowDependencies" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.plannedWorkflowDependencies.length > 0
                        ? item.plannedWorkflowDependencies
                        : ["No planned workflow dependencies"]
                      ).map((dependency) => (
                        <Badge key={dependency} variant="outline">
                          {dependency}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Button asChild size="sm" variant="outline">
                    <Link href={item.nextWorkflow}>
                      <T k="reportCenter.openNextWorkflow" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="persona-workspaces-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="persona-workspaces-title" className="text-xl font-semibold">
              <T k="reportCenter.workspaces" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="reportCenter.setupCoverageHint" />
            </p>
          </div>
          <Badge variant="outline">{visibleWorkspaceSummaries.length} roles</Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => {
            const WorkspaceIcon = workspace.icon;
            return (
              <Card key={workspace.persona}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.focus}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={workspace.readyReports > 0 ? "success" : "neutral"} dot>
                      {workspace.readyReports} ready
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.reports" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {workspace.catalogReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.ready" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {workspace.readyReports}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.automations" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {workspace.automationCount}
                      </div>
                    </div>
                  </div>

                  <div
                    className="grid grid-cols-3 gap-2 text-xs"
                    data-testid={`report-workspace-catalog-metadata-${workspace.persona}`}
                  >
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.packs" />
                      </div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {workspace.packTemplateCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.comparisons" />
                      </div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {workspace.comparisonPresetCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.starters" />
                      </div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {workspace.automationStarterCount}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        <T k="reportCenter.readiness" />
                      </span>
                      <span className="tabular-nums">{workspace.readiness}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${workspace.readiness}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.primarySignal" />
                    </div>
                    <div className="text-sm font-medium">{workspace.topReadyReport?.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {workspace.topReadyReport?.automation}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.automationOutcome" />
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {workspace.automationOutcome}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.reportPackCadence" />
                    </div>
                    <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Cadence:</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Delivery:</span>{" "}
                        {workspace.packSchedule.delivery}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Automation:</span>{" "}
                        {workspace.packSchedule.automation}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.automationPlaybooks" />
                    </div>
                    {workspace.automations.map((playbook) => {
                      const linkedReports = playbook.reportIds
                        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
                        .filter((report): report is (typeof reportCatalog)[number] =>
                          Boolean(report)
                        );

                      return (
                        <div key={playbook.id} className="rounded-md border p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <div className="text-sm font-medium">{playbook.title}</div>
                              <div className="text-xs text-muted-foreground">
                                Trigger: {playbook.trigger}
                              </div>
                              <div className="flex flex-wrap gap-1 pt-1">
                                {linkedReports.slice(0, 3).map((report) => (
                                  <Badge key={report.id} variant="outline">
                                    {report.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={reportAutomationPlaybookHref(playbook, workspace.persona)}
                              >
                                {playbook.cta}
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        navigate(reportWorkspaceHref(workspace));
                      }}
                      data-testid={`button-open-workspace-${workspace.persona}`}
                    >
                      <T k="reportCenter.openReports" />
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={reportSectionHref(workspace, "automation-command-center")}
                        data-testid={`button-open-automation-center-${workspace.persona}`}
                      >
                        <T k="reportCenter.openAutomations" />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReportPersonaFilter(workspace.persona)}
                    >
                      <T k="reportCenter.filterLibrary" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting}
                      onClick={() => handleExportWorkspacePack(workspace)}
                      data-testid={`button-export-workspace-pack-${workspace.persona}`}
                    >
                      <Download className="me-2 h-4 w-4" />
                      <T k="reportCenter.exportPack" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting || !selectedCompanyId}
                      onClick={() => handleExportWorkspacePackToSheets(workspace)}
                      data-testid={`button-export-workspace-pack-sheets-${workspace.persona}`}
                    >
                      <SiGooglesheets className="me-2 h-4 w-4" />
                      <T k="reportCenter.sheetsPack" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
