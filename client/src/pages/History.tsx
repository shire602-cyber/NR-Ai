import { T } from "@/components/layout/T";
import {
  activityActionLabel,
  activityDescription,
  activityEntityLabel,
} from "@/lib/activity-log-labels";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  History as HistoryIcon,
  Search,
  User,
  Building2,
  FileText,
  Receipt,
  Settings,
  Database,
  MoreHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format-date";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { apiUrl } from "@/lib/api";
import type { ActivityLog } from "@shared/schema";

export default function History() {
  const { t, locale } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { can, known } = useCompanyPermission();
  // Mirrors the server rule for GET /activity-logs (companyRolePolicy ACTIVITY_READ).
  const canReadActivity =
    !known || can("settings.company") || can("documents.approve") || can("ledger.post");
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");

  const {
    data: logs = [],
    isLoading,
    isError: logsFailed,
    refetch: refetchLogs,
  } = useQuery<ActivityLog[]>({
    queryKey: ["/api/companies", companyId, "activity-logs"],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(apiUrl(`/api/companies/${companyId}/activity-logs?limit=200`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch activity logs");
      return res.json();
    },
    enabled: !!companyId && canReadActivity,
    retry: false,
  });

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === "all" || log.action === actionFilter;
    const matchesEntity = entityFilter === "all" || log.entityType === entityFilter;
    return matchesSearch && matchesAction && matchesEntity;
  });

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case "user":
        return <User className="h-4 w-4" />;
      case "company":
        return <Building2 className="h-4 w-4" />;
      case "document":
        return <FileText className="h-4 w-4" />;
      case "invoice":
        return <Receipt className="h-4 w-4" />;
      case "journal_entry":
        return <FileText className="h-4 w-4" />;
      case "account":
        return <Building2 className="h-4 w-4" />;
      case "receipt":
        return <Receipt className="h-4 w-4" />;
      case "backup":
        return <Database className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const actionFilterLabel = (filter: (typeof ACTION_FILTERS)[number]) => {
    switch (filter) {
      case "all":
        return t["pages.allActions"];
      case "create":
        return t["pages.create"];
      case "update":
        return t["pages.update"];
      case "delete":
        return t["pages.delete"];
      default:
        return t["hr.view"];
    }
  };

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          <T k="pageLabels.pleaseSelectACompanyToViewHistory" />
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!canReadActivity) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Workspace"
          title={t["history.activityHistory"]}
          testId="text-history-title"
        />
        <EmptyState
          icon={HistoryIcon}
          title={t["common.noAccessTitle"]}
          description={t["common.noAccessBody"]}
          testId="state-history-no-access"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={t["history.activityHistory"]}
        testId="text-history-title"
        description={t["history.trackAllChangesMadeTo"]}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder={t["activityLogs.searchActivities"]}
              aria-label={t["activityLogs.searchActivities"]}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-9"
              data-testid="input-search-history"
            />
          </div>
          <div className="flex items-center gap-3">
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-filter-entity">
                <SelectValue placeholder={t["activityLogs.entityType"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <T k="pageLabels.allTypes" />
                </SelectItem>
                <SelectItem value="account">
                  <T k="shell.moreAccounts" />
                </SelectItem>
                <SelectItem value="invoice">
                  <T k="pages.invoices" />
                </SelectItem>
                <SelectItem value="journal_entry">
                  <T k="pages.journalEntries" />
                </SelectItem>
                <SelectItem value="receipt">
                  <T k="shell.navReceipts" />
                </SelectItem>
                <SelectItem value="backup">
                  <T k="pageLabels.backups" />
                </SelectItem>
              </SelectContent>
            </Select>
            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {formatMessage(t["activityLog.entries"], { count: filteredLogs.length })}
            </span>
          </div>
        </div>
        {/* Spec 3.10: action filters as chips. */}
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t["components.vwColAction"]}
          data-testid="select-filter-action"
        >
          {ACTION_FILTERS.map((filter) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={actionFilter === filter ? "default" : "outline"}
              aria-pressed={actionFilter === filter}
              className="h-8 rounded-full"
              onClick={() => setActionFilter(filter)}
              data-testid={`chip-history-action-${filter}`}
            >
              {actionFilterLabel(filter)}
            </Button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {logsFailed ? (
          <ErrorState compact onRetry={() => void refetchLogs()} testId="state-history-error" />
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title={t["pageLabels.noActivityYet"]}
            description={t["history.activityWillAppearHereAs"]}
            testId="state-history-empty"
          />
        ) : (
          <ul className="divide-y divide-border/70" data-testid="history-feed">
            {filteredLogs.map((log) => {
              const sentence = withoutIds(activityDescription(t, log, locale));
              const changes = metadataChanges(log.metadata);
              const created = log.createdAt ? new Date(log.createdAt) : null;
              return (
                <li
                  key={log.id}
                  className="flex items-start gap-3 px-4 py-3 sm:px-5"
                  data-testid={`row-history-${log.id}`}
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-sunken text-muted-foreground"
                    aria-hidden
                  >
                    {getEntityIcon(log.entityType)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-foreground">
                      {sentence || activityActionLabel(t, log.action)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                      <span>{activityEntityLabel(t, log.entityType)}</span>
                      <span aria-hidden>·</span>
                      <span>{activityActionLabel(t, log.action)}</span>
                      {changes ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{changes}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {created ? (
                      <time
                        dateTime={created.toISOString()}
                        title={`${formatDate(created, locale)} ${format(created, "HH:mm")}`}
                        className="whitespace-nowrap text-caption tabular-nums text-muted-foreground"
                      >
                        {relativeTime(created, locale)}
                      </time>
                    ) : null}
                    {log.entityId ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            aria-label={t["history.details"]}
                            data-testid={`button-history-details-${log.id}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-72 text-caption">
                          <dl className="space-y-2">
                            <div>
                              <dt className="text-muted-foreground">{t["history.details"]}</dt>
                              <dd className="mt-0.5 text-foreground">
                                {activityDescription(t, log, locale)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">{t["history.reference"]}</dt>
                              <dd className="mt-0.5 break-all font-mono text-foreground">
                                {log.entityId}
                              </dd>
                            </div>
                            {created ? (
                              <div>
                                <dt className="text-muted-foreground">
                                  <T k="pages.dateTime" />
                                </dt>
                                <dd className="mt-0.5 tabular-nums text-foreground">
                                  {formatDate(created, locale)} {format(created, "HH:mm")}
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

const ACTION_FILTERS = ["all", "create", "update", "delete", "view"] as const;

const UUID_RE = /\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Spec 3.10: ids live in the Details popover, never in the sentence. */
function withoutIds(text: string): string {
  return text
    .replace(UUID_RE, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function metadataChanges(metadata: string | null | undefined): string {
  if (!metadata) return "";
  try {
    const parsed = JSON.parse(metadata);
    return Array.isArray(parsed.changes) ? parsed.changes.join(", ") : "";
  } catch {
    return "";
  }
}

/** "3 minutes ago" / "منذ 3 دقائق"; older than a week shows the date. */
function relativeTime(date: Date, locale: string): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs >= 7 * 86400) return formatDate(date, locale);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", {
    numeric: "auto",
    // Latin digits in both languages, like every other figure.
    localeMatcher: "lookup",
  });
  const fmt = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    rtf.format(value, unit).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (abs < 60) return fmt(seconds, "second");
  if (abs < 3600) return fmt(Math.round(seconds / 60), "minute");
  if (abs < 86400) return fmt(Math.round(seconds / 3600), "hour");
  return fmt(Math.round(seconds / 86400), "day");
}
