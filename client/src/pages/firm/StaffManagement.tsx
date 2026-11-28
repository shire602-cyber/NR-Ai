import { T } from "@/components/layout/T";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Users, ChevronDown, ChevronRight, Shield, Search, Mail, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, refreshAfterWrite } from "@/lib/queryClient";
import type { Company } from "@shared/schema";
import { PausedReadNotice } from "@/components/ui/paused-read-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { hasReadData, queryReadState } from "@/lib/queryReadState";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  /** R15-03: staff are users with a firm role (never isAdmin-based). */
  firmRole: string;
  lastLoginAt: string | null;
  createdAt: string;
  assignedClients: {
    companyId: string;
    companyName: string;
    companyType: string;
    role: string;
  }[];
  assignedClientCount: number;
}

const FIRM_ROLE_KEYS: Record<string, string> = {
  firm_owner: "firm.roleFirmOwner",
  firm_admin: "firm.roleFirmAdmin",
  preparer: "firm.rolePreparer",
  reviewer: "firm.roleReviewer",
  viewer: "firm.roleViewer",
};

interface ClientWithStats extends Company {
  invoiceCount: number;
  assignedStaff: { id: string; name: string }[];
}

export default function StaffManagement() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [expandedStaff, setExpandedStaff] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, { staffId: string; companyId: string; action: "assign" | "unassign" }>
  >(new Map());
  const [saving, setSaving] = useState(false);

  const staffQuery = useQuery<StaffMember[]>({
    queryKey: ["/api/firm/staff"],
  });
  const clientsQuery = useQuery<ClientWithStats[]>({
    queryKey: ["/api/firm/clients"],
  });
  const staffState = queryReadState(staffQuery);
  const staffPaused = staffQuery.fetchStatus === "paused";
  const clientsPaused = clientsQuery.fetchStatus === "paused";
  const clientsState = queryReadState(clientsQuery);
  const staff = hasReadData(staffState) ? (staffQuery.data ?? []) : [];
  const clientsReady = hasReadData(clientsState);
  const clients = clientsReady ? (clientsQuery.data ?? []) : [];

  const searchTerm = search.toLowerCase();
  const filteredStaff = searchTerm
    ? staff.filter(
        (s) =>
          s.name.toLowerCase().includes(searchTerm) || s.email.toLowerCase().includes(searchTerm)
      )
    : staff;

  const toggleExpand = (staffId: string) => {
    setExpandedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  };

  const isAssigned = (staffMember: StaffMember, companyId: string): boolean => {
    const pending = pendingChanges.get(`${staffMember.id}:${companyId}`);
    return pending
      ? pending.action === "assign"
      : staffMember.assignedClients.some((c) => c.companyId === companyId);
  };

  const toggleAssignment = (staffMember: StaffMember, companyId: string) => {
    const key = `${staffMember.id}:${companyId}`;
    const currentlyAssigned = staffMember.assignedClients.some((c) => c.companyId === companyId);
    setPendingChanges((prev) => {
      const next = new Map(prev);
      // Toggle removes the pending change (reverts to original).
      if (!next.delete(key)) {
        next.set(key, {
          staffId: staffMember.id,
          companyId,
          action: currentlyAssigned ? "unassign" : "assign",
        });
      }
      return next;
    });
  };

  const saveChanges = async () => {
    if (pendingChanges.size === 0) return;
    setSaving(true);
    let success = 0;
    let failed = 0;

    for (const change of pendingChanges.values()) {
      try {
        await apiRequest("POST", `/api/firm/clients/${change.companyId}/assign-staff`, {
          staffUserId: change.staffId,
          action: change.action,
          role: "accountant",
        });
        success++;
      } catch {
        failed++;
      }
    }

    setSaving(false);
    setPendingChanges(new Map());
    refreshAfterWrite(["/api/firm/staff"]);
    refreshAfterWrite(["/api/firm/clients"]);

    if (failed === 0) {
      toast({ title: formatMessage(translateNow("toasts.assignmentsSaved"), { success }) });
    } else {
      toast({
        variant: "destructive",
        title: formatMessage(translateNow("toasts.savedFailed"), { success, failed }),
      });
    }
  };

  if (staffState === "pending") {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {staffPaused ? <PausedReadNotice testId="staff-waiting" /> : <T k="pages.loadingStaff" />}
      </div>
    );
  }

  const header = (
    <PageHeader
      eyebrow={t["firm.eyebrowFirm"]}
      title={t["firm.staffManagementTitle"]}
      description={t["firm.staffManagementDescription"]}
      actions={
        staffState !== "error" &&
        pendingChanges.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {formatMessage(t["firmOps.staffPendingChanges"], { count: pendingChanges.size })}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPendingChanges(new Map())}>
              <T k="pages.discard" />
            </Button>
            <Button size="sm" onClick={saveChanges} disabled={saving}>
              {saving ? t["pages.notificationPrefsSaving"] : t["pages.saveChanges"]}
            </Button>
          </div>
        )
      }
    />
  );

  if (staffState === "error") {
    return (
      <div className="space-y-6">
        {header}
        <LoadErrorState
          error={staffQuery.error}
          onRetry={() => void staffQuery.refetch()}
          testId="staff-load-error"
        />
      </div>
    );
  }

  const summaryCards = [
    { label: t["pages.totalStaff"], value: staff.length },
    {
      label: t["pages.clientCompanies"],
      value: clientsReady ? clients.length : "—",
      testId: "staff-client-count",
    },
    {
      label: t["pages.unassignedClients"],
      value: clientsReady ? clients.filter((c) => c.assignedStaff?.length === 0).length : "—",
    },
  ];

  return (
    <div className="space-y-6">
      {header}

      {staffPaused && <PausedReadNotice cached testId="staff-paused-cached" />}
      {!staffPaused && staffState === "stale" && (
        <StaleDataNotice onRetry={() => void staffQuery.refetch()} testId="staff-stale" />
      )}
      {clientsPaused && (clientsReady || clientsState === "pending") && (
        <PausedReadNotice
          cached={clientsReady}
          testId={clientsReady ? "staff-clients-paused-cached" : "staff-clients-waiting"}
        />
      )}
      {!clientsPaused && clientsState === "stale" && (
        <StaleDataNotice onRetry={() => void clientsQuery.refetch()} testId="staff-clients-stale" />
      )}
      {clientsState === "error" && (
        <LoadErrorState
          compact
          error={clientsQuery.error}
          onRetry={() => void clientsQuery.refetch()}
          testId="staff-clients-error"
        />
      )}

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t["firm.staffSearchPlaceholder"]}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ps-9"
        />
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {summaryCards.map(({ label, value, testId }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold mt-0.5" data-testid={testId}>
                {value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Staff list */}
      {filteredStaff.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold">
            <T k="pages.noStaffMembersFound" />
          </h3>
          <p className="text-muted-foreground text-sm mt-1">
            {search ? t["firmOps.staffTrySearch"] : t["firmOps.staffNoAdmins"]}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredStaff.map((member) => {
            const expanded = expandedStaff.has(member.id);
            const pendingForMember = [...pendingChanges.values()].filter(
              (c) => c.staffId === member.id
            );

            return (
              <Card key={member.id} className="overflow-hidden">
                {/* Staff row */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggleExpand(member.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{member.name}</p>
                        <Shield className="w-3.5 h-3.5 text-primary" />
                        <Badge variant="secondary" data-testid={`firm-role-${member.id}`}>
                          <T k={FIRM_ROLE_KEYS[member.firmRole] ?? "firm.firmRole"} />
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {member.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {pendingForMember.length > 0 && (
                      <Badge
                        variant="outline"
                        className="text-warning border-warning/30 bg-warning-subtle"
                      >
                        {formatMessage(t["firm.staff.pendingCount"], {
                          count: pendingForMember.length,
                        })}
                      </Badge>
                    )}
                    <div className="text-end">
                      <p className="text-sm font-medium">
                        {formatMessage(t["firm.staff.clientCount"], {
                          count: member.assignedClientCount,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t["firm.staff.assignedLabel"]}
                      </p>
                    </div>
                    {expanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded: client assignment grid */}
                {expanded && (
                  <div className="border-t bg-muted/20">
                    <div className="p-4">
                      <p className="text-xs font-medium text-muted-foreground mb-3">
                        <T k="pages.clientAssignments" />
                      </p>
                      {clientsState === "pending" && !clientsPaused ? (
                        <Skeleton className="h-16 w-full" data-testid="staff-clients-loading" />
                      ) : !clientsReady ? null : clients.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          <T k="pages.noClientCompaniesYet" />
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                          {clients.map((client) => {
                            const assigned = isAssigned(member, client.id);
                            const key = `${member.id}:${client.id}`;
                            const hasPending = pendingChanges.has(key);

                            return (
                              <label
                                key={client.id}
                                className={[
                                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                                  assigned ? "bg-primary/5 border-primary/20" : "hover:bg-muted/40",
                                  hasPending ? "ring-1 ring-warning" : "",
                                ].join(" ")}
                              >
                                <Checkbox
                                  checked={assigned}
                                  onCheckedChange={() => toggleAssignment(member, client.id)}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{client.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {client.trnVatNumber || t["firm.staff.noTrn"]}
                                  </p>
                                </div>
                                {assigned && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      navigate(`/firm/clients/${client.id}`);
                                    }}
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </Button>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
