import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Search,
  Filter,
  User,
  Building2,
  FileText,
  Receipt,
  Settings,
  Mail,
  Trash2,
  Edit,
  Plus,
  Eye,
  LogIn,
  LogOut,
  Download,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import type { ActivityLog, User as UserType, Company } from "@shared/schema";
import { messages as pageMessages } from "./ActivityLogs.i18n";

export default function ActivityLogs() {
  const tr = pageMessages.useT();

  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");

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
      case "login":
        return <LogIn className="h-4 w-4 text-chart-5" />;
      case "logout":
        return <LogOut className="h-4 w-4 text-warning" />;
      case "invite":
        return <Mail className="h-4 w-4 text-info" />;
      default:
        return <Activity className="h-4 w-4" />;
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
      case "invitation":
        return <Mail className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case "create":
        return (
          <Badge className="bg-success/10 text-success border-success/20">{tr("create")}</Badge>
        );
      case "update":
        return <Badge className="bg-info/10 text-info border-info/20">{tr("update")}</Badge>;
      case "delete":
        return <Badge variant="destructive">{tr("delete")}</Badge>;
      case "view":
        return <Badge variant="secondary">{tr("view")}</Badge>;
      case "login":
        return (
          <Badge className="bg-chart-5/10 text-chart-5 border-chart-5/20">{tr("login")}</Badge>
        );
      case "logout":
        return (
          <Badge className="bg-warning/10 text-warning border-warning/20">{tr("logout")}</Badge>
        );
      case "invite":
        return <Badge className="bg-info/10 text-info border-info/20">{tr("invite")}</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getUserName = (userId: string | null) => {
    if (!userId) return tr("system");
    const user = users.find((u) => u.id === userId);
    return user?.name || user?.email || tr("unknown");
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    const company = clients.find((c) => c.id === companyId);
    return company?.name || tr("unknown");
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
        eyebrow={tr("admin")}
        title={tr("activityLogs")}
        testId="text-logs-title"
        description={tr("completeAuditTrailOfAllSystem")}
        actions={
          <Button variant="outline" className="w-full sm:w-auto" data-testid="button-export-logs">
            <Download className="w-4 h-4 me-2" />
            {tr("exportLogs")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-1 min-w-[300px]">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tr("searchActivities")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10"
                  data-testid="input-search-logs"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-32" data-testid="select-filter-action">
                  <SelectValue placeholder={tr("action")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allActions")}</SelectItem>
                  <SelectItem value="create">{tr("create")}</SelectItem>
                  <SelectItem value="update">{tr("update")}</SelectItem>
                  <SelectItem value="delete">{tr("delete")}</SelectItem>
                  <SelectItem value="view">{tr("view")}</SelectItem>
                  <SelectItem value="login">{tr("login")}</SelectItem>
                  <SelectItem value="logout">{tr("logout")}</SelectItem>
                  <SelectItem value="invite">{tr("invite")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-36" data-testid="select-filter-entity">
                  <SelectValue placeholder={tr("entityType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allEntities")}</SelectItem>
                  <SelectItem value="user">{tr("users")}</SelectItem>
                  <SelectItem value="company">{tr("companies")}</SelectItem>
                  <SelectItem value="document">{tr("documents")}</SelectItem>
                  <SelectItem value="invoice">{tr("invoices")}</SelectItem>
                  <SelectItem value="journal_entry">{tr("journalEntries")}</SelectItem>
                  <SelectItem value="invitation">{tr("invitations")}</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="secondary">
                {tr("entries", { filteredLogsCount: filteredLogs.length })}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>{tr("description")}</TableHead>
                  <TableHead>{tr("action")}</TableHead>
                  <TableHead>{tr("entity")}</TableHead>
                  <TableHead>{tr("user")}</TableHead>
                  <TableHead>{tr("client")}</TableHead>
                  <TableHead>{tr("dateTime")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        {getActionIcon(log.action)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{log.description}</p>
                      {log.metadata && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {JSON.parse(log.metadata).changes?.join(", ") || ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getEntityIcon(log.entityType)}
                        <span className="capitalize">{log.entityType.replace("_", " ")}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {getUserName(log.userId)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {log.companyId ? (
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {getCompanyName(log.companyId)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.createdAt ? (
                        <div>
                          <p className="text-sm">
                            {format(new Date(log.createdAt), "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(log.createdAt), "h:mm a")}
                          </p>
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {searchTerm || actionFilter !== "all" || entityFilter !== "all"
                        ? tr("noLogsMatchYourFilters")
                        : tr("noActivityLogsYet")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
