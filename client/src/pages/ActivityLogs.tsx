import { T } from "@/components/layout/T";
import {
  activityEntityLabel,
  activitySentence,
  formatActivityCount,
  metadataChanges,
} from "@/lib/activity-log-labels";
import { formatDateTime } from "@/lib/format-date";
import { ActivityFeedMetaItem, ActivityFeedRow } from "@/components/ui/activity-feed-row";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { ErrorState } from "@/components/ui/error-state";
import { activitySearchText, matchesActionFilter } from "@/lib/activity-log-filters";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  User,
  Building2,
  FileText,
  Receipt,
  Settings,
  Mail,
  Download,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActivityLog, User as UserType, Company } from "@shared/schema";
import { useTranslation } from "@/lib/i18n";
import { freshChunkUrl, retryToken } from "@/lib/dialogChunk";
import { loadWithChunkRetry } from "@/lib/lazyWithReload";
import { exportActivityLogs } from "@/lib/export";
import type { AuditChainResult } from "./activity-logs/ActivityLogAuditChain";

type AuditChainModule = typeof import("./activity-logs/ActivityLogAuditChain");
let auditChunk: AuditChainModule | undefined;
let auditChunkAttempts = 0;

async function loadAuditChain() {
  if (auditChunk) return auditChunk;
  // A fresh URL retries even in browsers that cache failed module fetches for this document.
  const attempt = auditChunkAttempts++;
  let loaded: AuditChainModule;
  if (attempt === 0) {
    loaded = await import("./activity-logs/ActivityLogAuditChain");
  } else {
    const path = import.meta.env.DEV
      ? "./activity-logs/ActivityLogAuditChain.ts"
      : "__MUHASIB_DIALOG_CHUNK__ActivityLogAuditChain__";
    loaded = await import(
      /* @vite-ignore */ freshChunkUrl(new URL(path, import.meta.url), retryToken(attempt))
    );
  }
  auditChunk = loaded;
  return loaded;
}

const actionOptions = {
  all: "pages.allActions",
  create: "pages.create",
  update: "pages.update",
  delete: "pages.delete",
  view: "hr.view",
  login: "pages.login",
  logout: "pages.logout",
  invite: "pages.invite",
};

const entityOptions = {
  all: "pages.allEntities",
  user: "pages.users",
  company: "pages.companies",
  document: "pages.documents",
  invoice: "pages.invoices",
  journal_entry: "pages.journalEntries",
  invitation: "pages.invitations",
};

const entityIcons = new Map<string, LucideIcon>([
  ["user", User],
  ["company", Building2],
  ["document", FileText],
  ["invoice", Receipt],
  ["invitation", Mail],
]);

function filterOptions(options: Record<string, string>, t: Record<string, string>) {
  return Object.entries(options).map(([value, label]) => (
    <SelectItem key={value} value={value}>
      {t[label]}
    </SelectItem>
  ));
}

export default function ActivityLogs() {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const { t, locale } = useTranslation();
  // W5-E: verify the account-level ("global") tamper-evident audit chain.
  const [chainResult, setChainResult] = useState<AuditChainResult | null>(null);
  const [chainState, setChainState] = useState<"idle" | "checking" | "failed">("idle");
  const verifyGlobalChain = async () => {
    setChainResult(null);
    setChainState("checking");
    try {
      const { verifyAuditChain } = await loadWithChunkRetry(loadAuditChain, {
        key: "activity-log-audit-chain",
        reload: false,
      });
      setChainResult(await verifyAuditChain());
      setChainState("idle");
    } catch {
      setChainState("failed");
    }
  };

  const {
    data: loadedLogs,
    isPending,
    isPaused,
    isLoadingError,
    isRefetchError,
    refetch: refetchLogs,
  } = useQuery<ActivityLog[]>({
    queryKey: ["/api/admin/activity-logs"],
  });
  // `undefined` means nothing has loaded yet: only a successful load may be reported as empty.
  const hasLoadedLogs = loadedLogs !== undefined;
  const logs = loadedLogs ?? [];

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: clients = [] } = useQuery<Company[]>({
    queryKey: ["/api/admin/clients"],
  });

  const needle = searchTerm.trim().toLowerCase();
  const hasActiveFilters = needle !== "" || actionFilter !== "all" || entityFilter !== "all";

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      !needle ||
      activitySearchText(t, log, locale, [
        users.find((u) => u.id === log.userId)?.name,
        users.find((u) => u.id === log.userId)?.email,
        clients.find((c) => c.id === log.companyId)?.name,
      ]).includes(needle);
    const matchesAction = matchesActionFilter(log.action, actionFilter);
    const matchesEntity = entityFilter === "all" || log.entityType === entityFilter;
    return matchesSearch && matchesAction && matchesEntity;
  });

  const getUserName = (userId: string | null) => {
    if (!userId) return t["shell.themeSystem"];
    const user = users.find((u) => u.id === userId);
    return user?.name || user?.email || t["activityLog.unknown"];
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    const company = clients.find((c) => c.id === companyId);
    return company?.name || t["activityLog.unknown"];
  };

  // A paused first load is pending too, but gets its own status below instead of a spinner.
  if (isPending && !isPaused) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["pages.eyebrowAdmin"]}
        title={t["pageLabels.activityLogs"]}
        testId="text-logs-title"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={verifyGlobalChain}
              disabled={chainState === "checking"}
              data-testid="button-verify-global-chain"
            >
              <ShieldCheck className="w-4 h-4 me-2" />
              <T k="security.auditVerify" />
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void exportActivityLogs(filteredLogs, users, t, locale)}
              disabled={filteredLogs.length === 0}
              data-testid="button-export-logs"
            >
              <Download className="w-4 h-4 me-2" />
              <T k="pages.exportLogs" />
            </Button>
          </div>
        }
      />
      {chainState === "checking" && (
        <p className="text-sm text-muted-foreground" role="status">
          {t["activityLogs.chainChecking"]}
        </p>
      )}
      {chainState === "failed" && (
        <p className="text-sm text-destructive" role="alert" data-testid="text-global-chain-error">
          {t["activityLogs.chainCheckFailed"]}
        </p>
      )}
      {chainResult && (
        <p
          className={`text-sm ${chainResult.ok ? "" : "text-destructive"}`}
          role="status"
          data-testid="text-global-chain"
        >
          {chainResult.format(t, locale)}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex w-full min-w-0 items-center gap-4 sm:min-w-[300px] sm:flex-1 sm:w-auto">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t["activityLogs.searchActivities"]}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                  data-testid="input-search-logs"
                />
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-32" data-testid="select-filter-action">
                  <SelectValue placeholder={t["components.vwColAction"]} />
                </SelectTrigger>
                <SelectContent>{filterOptions(actionOptions, t)}</SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-36" data-testid="select-filter-entity">
                  <SelectValue placeholder={t["activityLogs.entityType"]} />
                </SelectTrigger>
                <SelectContent>{filterOptions(entityOptions, t)}</SelectContent>
              </Select>
            </div>
          </div>
          {hasLoadedLogs && (
            <Badge
              variant="secondary"
              className="w-fit whitespace-normal"
              role="status"
              data-testid="badge-log-count"
            >
              {formatActivityCount(t["activityLogs.resultCount"], filteredLogs.length, locale)}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {/* Fable B13: the activity-feed row (History, admin audit tab): one sentence with no
              ids, actor and client on a second line, a one-line formatted date. */}
          {hasLoadedLogs && isPaused ? (
            <p
              role="status"
              className="border-b border-border/70 px-4 py-3 text-sm text-muted-foreground sm:px-5"
              data-testid="status-activity-logs-refresh-paused"
            >
              {t["activityLogs.refreshPaused"]}
            </p>
          ) : isRefetchError ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3 sm:px-5"
              data-testid="state-activity-logs-refresh-error"
            >
              <p role="alert" className="text-sm text-destructive">
                {t["activityLogs.refreshFailed"]}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetchLogs()}
                data-testid="button-retry-refresh-logs"
              >
                {t["components.errorRetry"]}
              </Button>
            </div>
          ) : null}
          {!hasLoadedLogs && isPaused ? (
            <p
              role="status"
              className="px-4 py-6 text-small text-muted-foreground sm:px-5"
              data-testid="status-activity-logs-paused"
            >
              {t["activityLogs.loadPaused"]}
            </p>
          ) : isLoadingError ? (
            <ErrorState
              compact
              title={t["activityLogs.loadFailedTitle"]}
              description={t["activityLogs.loadFailedDescription"]}
              onRetry={() => void refetchLogs()}
              testId="state-activity-logs-error"
            />
          ) : hasLoadedLogs && filteredLogs.length === 0 ? (
            <EmptyState
              size="sm"
              className="px-4 py-6 sm:px-5"
              title={
                hasActiveFilters
                  ? t["activityLogs.noLogsMatchYourFilters"]
                  : t["activityLogs.noActivityLogsYet"]
              }
              action={
                hasActiveFilters
                  ? {
                      label: t["activityLogs.clearFilters"],
                      onClick: () => {
                        setSearchTerm("");
                        setActionFilter("all");
                        setEntityFilter("all");
                      },
                    }
                  : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-border/70" data-testid="activity-log-feed">
              {filteredLogs.map((log) => {
                const changes = metadataChanges(log.metadata);
                const company = getCompanyName(log.companyId);
                const EntityIcon = entityIcons.get(log.entityType) ?? Settings;
                return (
                  <ActivityFeedRow
                    key={log.id}
                    testId={`row-log-${log.id}`}
                    icon={<EntityIcon className="h-4 w-4" />}
                    sentence={activitySentence(t, log, locale)}
                    trailing={
                      log.createdAt ? (
                        <time
                          dateTime={new Date(log.createdAt).toISOString()}
                          className="shrink-0 whitespace-nowrap text-caption tabular-nums text-muted-foreground"
                        >
                          {formatDateTime(log.createdAt, locale)}
                        </time>
                      ) : null
                    }
                  >
                    <span translate="no">{getUserName(log.userId)}</span>
                    {company && (
                      <ActivityFeedMetaItem translate="no">{company}</ActivityFeedMetaItem>
                    )}
                    <ActivityFeedMetaItem>
                      {activityEntityLabel(t, log.entityType)}
                    </ActivityFeedMetaItem>
                    {changes && <ActivityFeedMetaItem truncate>{changes}</ActivityFeedMetaItem>}
                  </ActivityFeedRow>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
