import { T } from "@/components/layout/T";
import {
  activityActionLabel,
  activityEntityLabel,
  activitySentence,
  metadataChanges,
} from "@/lib/activity-log-labels";
import { formatDateTime, formatDateTimePlain } from "@/lib/format-date";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { securityFetch } from "@/lib/securityApi";
import { exportToExcel } from "@/lib/export";

export default function ActivityLogs() {
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const { t, locale } = useTranslation();
  // W5-E: verify the account-level ("global") tamper-evident audit chain.
  const [chainStatus, setChainStatus] = useState<{
    ok: boolean;
    checked: number;
    firstBroken: { seq: number; reason: string } | null;
  } | null>(null);
  const verifyGlobalChain = async () => {
    try {
      setChainStatus(await securityFetch("GET", "/api/admin/audit-log/verify"));
    } catch {
      setChainStatus(null);
    }
  };

  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/admin/activity-logs"],
  });

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: clients = [] } = useQuery<Company[]>({
    queryKey: ["/api/admin/clients"],
  });

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === "all" || log.action === actionFilter;
    const matchesEntity = entityFilter === "all" || log.entityType === entityFilter;
    return matchesSearch && matchesAction && matchesEntity;
  });

  // Broken-path sweep: "Export logs" had no handler. It exports the rows the filters show.
  const exportLogs = () =>
    exportToExcel(
      [
        {
          sheetName: t["activityLog.export.sheet"],
          rtl: locale === "ar",
          columns: [
            { header: t["activityLog.export.date"], key: "date", width: 20 },
            { header: t["activityLog.export.user"], key: "user", width: 28 },
            { header: t["activityLog.export.action"], key: "action", width: 28 },
            { header: t["activityLog.export.entity"], key: "entity", width: 22 },
            { header: t["activityLog.export.description"], key: "description", width: 60 },
          ],
          rows: filteredLogs.map((log) => ({
            date: formatDateTimePlain(log.createdAt, locale),
            user: users.find((u) => u.id === log.userId)?.email ?? "",
            action: activityActionLabel(t, log.action),
            entity: activityEntityLabel(t, log.entityType ?? ""),
            description: activitySentence(t, log, locale),
          })),
        },
      ],
      "activity-log"
    );

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
      case "invitation":
        return <Mail className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title={t["pageLabels.activityLogs"]}
        testId="text-logs-title"
        description={t["activityLogs.completeAuditTrailOfAll"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={verifyGlobalChain}
              data-testid="button-verify-global-chain"
            >
              <ShieldCheck className="w-4 h-4 me-2" />
              <T k="security.auditVerify" />
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void exportLogs()}
              disabled={filteredLogs.length === 0}
              data-testid="button-export-logs"
            >
              <Download className="w-4 h-4 me-2" />
              <T k="pages.exportLogs" />
            </Button>
          </div>
        }
      />
      {chainStatus && (
        <p
          className={`text-sm ${chainStatus.ok ? "" : "text-destructive"}`}
          role="status"
          data-testid="text-global-chain"
        >
          {chainStatus.ok
            ? formatMessage(t["security.auditVerified"], { count: chainStatus.checked })
            : formatMessage(t["security.auditBroken"], {
                seq: chainStatus.firstBroken?.seq ?? "?",
                reason: chainStatus.firstBroken?.reason ?? "",
              })}
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
                <SelectContent>
                  <SelectItem value="all">
                    <T k="pages.allActions" />
                  </SelectItem>
                  <SelectItem value="create">
                    <T k="pages.create" />
                  </SelectItem>
                  <SelectItem value="update">
                    <T k="pages.update" />
                  </SelectItem>
                  <SelectItem value="delete">
                    <T k="pages.delete" />
                  </SelectItem>
                  <SelectItem value="view">{t["hr.view"]}</SelectItem>
                  <SelectItem value="login">
                    <T k="pages.login" />
                  </SelectItem>
                  <SelectItem value="logout">
                    <T k="pages.logout" />
                  </SelectItem>
                  <SelectItem value="invite">
                    <T k="pages.invite" />
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-36" data-testid="select-filter-entity">
                  <SelectValue placeholder={t["activityLogs.entityType"]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <T k="pages.allEntities" />
                  </SelectItem>
                  <SelectItem value="user">
                    <T k="pages.users" />
                  </SelectItem>
                  <SelectItem value="company">
                    <T k="pages.companies" />
                  </SelectItem>
                  <SelectItem value="document">
                    <T k="pages.documents" />
                  </SelectItem>
                  <SelectItem value="invoice">
                    <T k="pages.invoices" />
                  </SelectItem>
                  <SelectItem value="journal_entry">
                    <T k="pages.journalEntries" />
                  </SelectItem>
                  <SelectItem value="invitation">
                    <T k="pages.invitations" />
                  </SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="secondary" className="whitespace-nowrap">
                {formatMessage(t["activityLog.entries"], { count: filteredLogs.length })}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Fable B13: the activity-feed row (History, admin audit tab): one sentence with no
              ids, actor and client on a second line, a one-line formatted date. */}
          {filteredLogs.length === 0 ? (
            <EmptyState
              size="sm"
              className="px-4 py-6 sm:px-5"
              title={
                searchTerm || actionFilter !== "all" || entityFilter !== "all"
                  ? t["activityLogs.noLogsMatchYourFilters"]
                  : t["activityLogs.noActivityLogsYet"]
              }
            />
          ) : (
            <ul className="divide-y divide-border/70" data-testid="activity-log-feed">
              {filteredLogs.map((log) => {
                const changes = metadataChanges(log.metadata);
                const company = getCompanyName(log.companyId);
                return (
                  <li
                    key={log.id}
                    className="flex items-start gap-3 px-4 py-3 sm:px-5"
                    data-testid={`row-log-${log.id}`}
                  >
                    <span
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-sunken text-muted-foreground"
                      aria-hidden
                    >
                      {getEntityIcon(log.entityType)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-body text-foreground">
                        {activitySentence(t, log, locale)}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                        <span translate="no">{getUserName(log.userId)}</span>
                        {company ? (
                          <span className="inline-flex items-baseline gap-x-2">
                            <span aria-hidden>·</span>
                            <span translate="no">{company}</span>
                          </span>
                        ) : null}
                        <span className="inline-flex items-baseline gap-x-2">
                          <span aria-hidden>·</span>
                          <span>{activityEntityLabel(t, log.entityType)}</span>
                        </span>
                        {changes ? (
                          <span className="inline-flex min-w-0 items-baseline gap-x-2">
                            <span aria-hidden>·</span>
                            <span className="truncate">{changes}</span>
                          </span>
                        ) : null}
                      </p>
                    </div>
                    {log.createdAt ? (
                      <time
                        dateTime={new Date(log.createdAt).toISOString()}
                        className="shrink-0 whitespace-nowrap text-caption tabular-nums text-muted-foreground"
                      >
                        {formatDateTime(log.createdAt, locale)}
                      </time>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
