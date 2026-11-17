import { T } from "@/components/layout/T";
import { dateFnsOptions } from "@/lib/date-locale";
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
  Trash2,
  Edit,
  Plus,
  Eye,
  Database,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const getActionIcon = (action: string) => {
    switch (action) {
      case "create":
        return <Plus className="h-4 w-4 text-success" />;
      case "update":
        return <Edit className="h-4 w-4 text-info" />;
      case "delete":
        return <Trash2 className="h-4 w-4 text-destructive" />;
      case "view":
        return <Eye className="h-4 w-4 text-muted-foreground" />;
      default:
        return <HistoryIcon className="h-4 w-4" />;
    }
  };

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

  const getActionBadge = (action: string) => {
    switch (action) {
      case "create":
        return (
          <Badge className="bg-success/10 text-success border-success/20">
            <T k="pages.create" />
          </Badge>
        );
      case "update":
        return (
          <Badge className="bg-info/10 text-info border-info/20">
            <T k="pages.update" />
          </Badge>
        );
      case "delete":
        return (
          <Badge variant="destructive">
            <T k="pages.delete" />
          </Badge>
        );
      case "view":
        return <Badge variant="secondary">{t["hr.view"]}</Badge>;
      default:
        return <Badge variant="outline">{activityActionLabel(t, action)}</Badge>;
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
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-1 min-w-[300px]">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t["activityLogs.searchActivities"]}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-history"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-36" data-testid="select-filter-entity">
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
              <Badge variant="secondary">
                {formatMessage(t["activityLog.entries"], { count: filteredLogs.length })}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {logsFailed ? (
              <ErrorState compact onRetry={() => void refetchLogs()} testId="state-history-error" />
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-12">
                <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  <T k="pageLabels.noActivityYet" />
                </h3>
                <p className="text-muted-foreground">{t["history.activityWillAppearHereAs"]}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>
                      <T k="pages.description" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.action" />
                    </TableHead>
                    <TableHead>{t["consolidation.kind"]}</TableHead>
                    <TableHead>
                      <T k="pages.dateTime" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-history-${log.id}`}>
                      <TableCell>
                        <div className="flex items-center justify-center">
                          {getActionIcon(log.action)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{activityDescription(t, log, locale)}</p>
                        {log.metadata && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {(() => {
                              try {
                                const parsed = JSON.parse(log.metadata);
                                return parsed.changes?.join(", ") || "";
                              } catch {
                                return "";
                              }
                            })()}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getEntityIcon(log.entityType)}
                          <span className="capitalize">
                            {activityEntityLabel(t, log.entityType)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.createdAt ? (
                          <div>
                            <p className="text-sm">
                              {format(
                                new Date(log.createdAt),
                                "MMM d, yyyy",
                                dateFnsOptions(locale)
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(log.createdAt), "h:mm a", dateFnsOptions(locale))}
                            </p>
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
