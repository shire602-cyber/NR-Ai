import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, FileSpreadsheet, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
} from "@/lib/reportCatalogApi";
import {
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportCatalog,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportWorkspaceHref,
  type ReportAutomationStarter,
  type ReportCatalogItem,
  type ReportDecisionShortcut,
  type ReportDeliverySubscription,
  type ReportPersona,
  type ReportPersonaWorkspace,
} from "@/lib/reportCatalog";
import { cn } from "@/lib/utils";

interface ReportLaunchPickerProps {
  persona?: ReportPersona;
  mode?: "general" | "delivery";
  className?: string;
}

type LaunchReport = Omit<ReportCatalogItem, "href"> & { href?: string | null };

function reportItemHref(report: LaunchReport): string {
  return report.href ?? reportHref({ href: undefined, tab: report.tab }) ?? "/reports";
}

function starterHref(starter: ReportAutomationStarter & { href?: string | null }): string {
  return starter.href ?? reportAutomationStarterHref(starter);
}

function shortcutHref(shortcut: ReportDecisionShortcut & { href?: string | null }): string {
  return shortcut.href ?? reportDecisionShortcutHref(shortcut);
}

function deliveryHref(subscription: ReportDeliverySubscription & { href?: string | null }): string {
  return subscription.href ?? reportDeliverySubscriptionHref(subscription);
}

function workspaceHref(workspace: ReportPersonaWorkspace & { href?: string | null }): string {
  return workspace.href ?? reportWorkspaceHref(workspace);
}

export function ReportLaunchPicker({
  persona = "owner",
  mode = "general",
  className,
}: ReportLaunchPickerProps) {
  const [selectedPersona, setSelectedPersona] = useState<ReportPersona>(persona);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setSelectedPersona(persona);
  }, [persona]);

  const catalogQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(selectedPersona),
    queryFn: () => fetchReportCatalogDiscovery(selectedPersona),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const syncedCatalog = catalogQuery.data;
  const workspace =
    syncedCatalog?.workspaces[0] ??
    reportPersonaWorkspaces.find((item) => item.persona === selectedPersona) ??
    reportPersonaWorkspaces[0];
  const reports = useMemo(() => {
    const source =
      syncedCatalog?.reports ??
      reportCatalog
        .filter((report) => report.personas.includes(selectedPersona))
        .map((report) => ({ ...report, href: reportHref(report) ?? null }));
    const normalizedQuery = query.trim().toLowerCase();

    return source
      .filter((report) => report.status === "live")
      .filter((report) => {
        if (!normalizedQuery) return true;
        return [report.name, report.category, report.decisionQuestion, report.commandKeywords]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [query, selectedPersona, syncedCatalog?.reports]);
  const shortcuts =
    syncedCatalog?.decisionShortcuts ??
    reportDecisionShortcuts.filter((shortcut) => shortcut.persona === selectedPersona);
  const starters =
    syncedCatalog?.automationStarters ??
    reportAutomationStarters.filter((starter) => starter.persona === selectedPersona);
  const deliverySubscriptions =
    syncedCatalog?.deliverySubscriptions ??
    reportDeliverySubscriptions.filter((subscription) => subscription.persona === selectedPersona);
  const isDeliveryMode = mode === "delivery";

  return (
    <Card
      className={cn("border-card-border", className)}
      data-testid={isDeliveryMode ? "report-delivery-launch-picker" : "report-launch-picker"}
    >
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase font-semibold text-muted-foreground">
              {isDeliveryMode ? "Delivery setup" : "Report launcher"}
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {workspace.navLabel}
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {isDeliveryMode
                ? `Choose the reports, guardrails, and automation starters that should feed scheduled sends for ${workspace.navLabel.toLowerCase()}.`
                : workspace.automationOutcome}
            </p>
          </div>
          <Badge
            variant={catalogQuery.isError ? "warning" : "info"}
            data-testid="report-launch-sync"
          >
            {catalogQuery.isLoading
              ? "Syncing"
              : catalogQuery.isError
                ? "Local catalog"
                : `${syncedCatalog?.summary.liveReportCount ?? reports.length} synced reports`}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            {reportPersonas.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSelectedPersona(item)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  item === selectedPersona
                    ? "border-accent bg-accent/5 text-foreground"
                    : "border-border/70 text-muted-foreground hover:border-accent hover:bg-accent/5"
                )}
                data-testid={`report-launch-persona-${item}`}
              >
                {reportPersonaWorkspaces.find((workspaceItem) => workspaceItem.persona === item)
                  ?.navLabel ?? item}
              </button>
            ))}
          </div>

          <div className="min-w-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reports, questions, and automations"
                className="pl-9"
                data-testid="report-launch-search"
              />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-md border border-border/70">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Reports
                  </div>
                  <Link href={workspaceHref(workspace)}>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-accent">
                      Workspace <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
                <div className="divide-y divide-border/50">
                  {reports.map((report) => (
                    <Link key={report.id} href={reportItemHref(report)}>
                      <div
                        className="flex cursor-pointer items-start justify-between gap-3 px-3 py-3 transition-colors hover:bg-accent/5"
                        data-testid={`report-launch-report-${report.id}`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{report.name}</div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {report.decisionQuestion}
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {report.category}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {isDeliveryMode ? (
                  <div className="rounded-md border border-border/70 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> Delivery subscriptions
                    </div>
                    <div className="mt-3 space-y-2">
                      {deliverySubscriptions.slice(0, 2).map((subscription) => (
                        <Link key={subscription.id} href={deliveryHref(subscription)}>
                          <div
                            className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5"
                            data-testid={`report-launch-delivery-subscription-${subscription.id}`}
                          >
                            <div className="font-medium text-foreground">{subscription.title}</div>
                            <div className="mt-1 text-muted-foreground">
                              {subscription.cadence} · {subscription.channel}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Decision shortcuts
                  </div>
                  <div className="mt-3 space-y-2">
                    {shortcuts.slice(0, 2).map((shortcut) => (
                      <Link key={shortcut.id} href={shortcutHref(shortcut)}>
                        <div className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5">
                          <div className="font-medium text-foreground">{shortcut.question}</div>
                          <div className="mt-1 text-muted-foreground">{shortcut.answer}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border/70 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> Automation starters
                  </div>
                  <div className="mt-3 space-y-2">
                    {starters.slice(0, 2).map((starter) => (
                      <Link key={starter.id} href={starterHref(starter)}>
                        <div className="rounded-md bg-muted/30 p-2 text-xs transition-colors hover:bg-accent/5">
                          <div className="font-medium text-foreground">{starter.title}</div>
                          <div className="mt-1 text-muted-foreground">{starter.outcome}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
