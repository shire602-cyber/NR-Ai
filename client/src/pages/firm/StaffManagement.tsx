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
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Company } from "@shared/schema";

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

  const { data: staff = [], isLoading: loadingStaff } = useQuery<StaffMember[]>({
    queryKey: ["/api/firm/staff"],
  });

  const { data: clients = [] } = useQuery<ClientWithStats[]>({
    queryKey: ["/api/firm/clients"],
  });

  const filteredStaff = staff.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase())
  );

  const toggleExpand = (staffId: string) => {
    setExpandedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(staffId)) next.delete(staffId);
      else next.add(staffId);
      return next;
    });
  };

  const isAssigned = (staffMember: StaffMember, companyId: string): boolean => {
    const key = `${staffMember.id}:${companyId}`;
    if (pendingChanges.has(key)) {
      return pendingChanges.get(key)!.action === "assign";
    }
    return staffMember.assignedClients.some((c) => c.companyId === companyId);
  };

  const toggleAssignment = (staffMember: StaffMember, companyId: string) => {
    const key = `${staffMember.id}:${companyId}`;
    const currentlyAssigned = staffMember.assignedClients.some((c) => c.companyId === companyId);
    const pendingAction = pendingChanges.get(key)?.action;

    setPendingChanges((prev) => {
      const next = new Map(prev);
      if (pendingAction) {
        // Toggle removes the pending change (reverts to original)
        next.delete(key);
      } else {
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
    queryClient.invalidateQueries({ queryKey: ["/api/firm/staff"] });
    queryClient.invalidateQueries({ queryKey: ["/api/firm/clients"] });

    if (failed === 0) {
      toast({ title: formatMessage(translateNow("toasts.assignmentsSaved"), { success }) });
    } else {
      toast({
        variant: "destructive",
        title: formatMessage(translateNow("toasts.savedFailed"), { success, failed }),
      });
    }
  };

  if (loadingStaff) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <T k="pages.loadingStaff" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["firm.eyebrowFirm"]}
        title={t["firm.staffManagementTitle"]}
        description={t["firm.staffManagementDescription"]}
        actions={
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
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.totalStaff" />
            </p>
            <p className="text-2xl font-bold mt-0.5">{staff.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.clientCompanies" />
            </p>
            <p className="text-2xl font-bold mt-0.5">{clients.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.unassignedClients" />
            </p>
            <p className="text-2xl font-bold mt-0.5">
              {clients.filter((c) => c.assignedStaff?.length === 0).length}
            </p>
          </CardContent>
        </Card>
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
                      {clients.length === 0 ? (
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
