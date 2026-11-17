import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { BookOpen, LayoutGrid } from "lucide-react";
import { T } from "@/components/layout/T";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import { useToast } from "@/hooks/use-toast";
import { translateNow, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BookkeeperDashboard, ClientWithStats } from "./portfolio/types";
import { formatDays, hasClientService, ownerPreview, priorityLabel } from "./portfolio/helpers";
import { PriorityBadge, ServiceScopeBadges, StatusBadge } from "./portfolio/badges";
import { OperationsBriefDialog } from "./portfolio/OperationsBriefDialog";
import { BookkeeperCommandCenter } from "./portfolio/BookkeeperCommandCenter";
import { RevenueGrowthPanel } from "./portfolio/RevenueGrowthPanel";
import { VatWorkspaceDialog, VatWorkspacePanel } from "./portfolio/VatWorkspace";
import { useFirmText } from "./portfolio/text";

/**
 * Practice command centre > Service plan: the bookkeeping production planner, the service matrix,
 * the revenue opportunities and the VAT workspace. These used to sit above the client list on
 * /firm/clients (spec 3.17); the list is now only the clients table.
 */
export function PracticePlanTab() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { b, fx, fdShort } = useFirmText();
  const { setActiveClientCompany } = useActiveCompany();
  const [briefClientId, setBriefClientId] = useState<string | null>(null);
  const [vatWorkspaceClientId, setVatWorkspaceClientId] = useState<string | null>(null);

  const { data: clients = [] } = useQuery<ClientWithStats[]>({ queryKey: ["/api/firm/clients"] });
  const { data: bookkeeperDashboard } = useQuery<BookkeeperDashboard>({
    queryKey: ["/api/firm/bookkeeper-dashboard"],
  });

  const bookkeeperByClientId = useMemo(
    () => new Map((bookkeeperDashboard?.clients ?? []).map((client) => [client.companyId, client])),
    [bookkeeperDashboard]
  );
  const briefClient = briefClientId ? bookkeeperByClientId.get(briefClientId) : undefined;
  const vatWorkspaceClient = vatWorkspaceClientId
    ? clients.find((client) => client.id === vatWorkspaceClientId)
    : undefined;
  const vatWorkspaceOps = vatWorkspaceClientId
    ? bookkeeperByClientId.get(vatWorkspaceClientId)
    : undefined;

  const switchMutation = useMutation({
    mutationFn: (companyId: string) => apiRequest("POST", `/api/firm/clients/${companyId}/switch`),
    onSuccess: (_, companyId) => {
      setActiveClientCompany(companyId);
      // Force a refetch of /api/companies so the active company is in cache.
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      navigate("/dashboard");
    },
    onError: (e: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotOpenClientBooks"),
        description: e?.message,
      });
    },
  });

  const handleOpenBooks = (id: string) => switchMutation.mutate(id);
  const handleViewProfile = (id: string) => navigate(`/firm/clients/${id}`);

  return (
    <div className="space-y-6" data-testid="practice-plan-tab">
      <BookkeeperCommandCenter
        dashboard={bookkeeperDashboard}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
        onOpenBrief={setBriefClientId}
        onManageStaff={() => navigate("/firm/staff")}
      />

      {bookkeeperDashboard && clients.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-primary" />
                <T k="pages.portfolioProductionMatrix" />
              </CardTitle>
              <Badge variant="outline">
                {Math.min(clients.length, 12)} / {clients.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.client" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.owner" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.services" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.priority" />
                  </TableHead>
                  <TableHead>VAT</TableHead>
                  <TableHead>
                    <T k="pages.corporateTax" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.close" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.nextAction2" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.slice(0, 12).map((client) => {
                  const ops = bookkeeperByClientId.get(client.id);
                  return (
                    <TableRow key={`matrix-${client.id}`} className="hover:bg-muted/50">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => handleViewProfile(client.id)}
                          className="font-medium text-start hover:underline"
                        >
                          {client.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {client.trnVatNumber || b("No TRN", "بلا رقم تسجيل ضريبي")}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops
                          ? fx(ownerPreview(ops.assignedStaff.map((staff) => staff.name)))
                          : fx(ownerPreview(client.assignedStaff.map((staff) => staff.name)))}
                      </TableCell>
                      <TableCell>
                        <ServiceScopeBadges
                          services={ops?.serviceScope ?? client.serviceScope}
                          compact
                        />
                      </TableCell>
                      <TableCell>
                        {ops ? (
                          <PriorityBadge priority={ops.priority} />
                        ) : (
                          <StatusBadge
                            active={client.invoiceCount > 0 || !!client.lastReceiptDate}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ops && hasClientService(ops, "vat") ? (
                          <div>
                            <span>
                              {fdShort(ops.vat.dueDate)} · {fx(formatDays(ops.vat.daysTilDue))}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {fx(ops.vat.cohortLabel)}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="outline">
                            <T k="pages.notScoped" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ops && hasClientService(ops, "corporate_tax")
                          ? `${fdShort(ops.corporateTax.dueDate)} · ${fx(formatDays(ops.corporateTax.daysTilDue))}`
                          : b("Not scoped", "خارج النطاق")}
                      </TableCell>
                      <TableCell>
                        {ops && hasClientService(ops, "bookkeeping") ? (
                          <div className="min-w-28">
                            <div className="flex items-center justify-between text-xs">
                              <span>{ops.bookkeeping.closeProgress}%</span>
                              <span className="text-muted-foreground">
                                {fx(priorityLabel(ops.bookkeeping.status))}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${ops.bookkeeping.closeProgress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          b("Not scoped", "خارج النطاق")
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2 min-w-64">
                          <p className="text-sm text-muted-foreground truncate">
                            {fx(ops?.nextBestAction) || b("Open client profile", "فتح ملف العميل")}
                          </p>
                          <div className="flex gap-1">
                            {ops && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setBriefClientId(client.id)}
                              >
                                <T k="pages.brief" />
                              </Button>
                            )}
                            {(!ops || hasClientService(ops, "vat")) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setVatWorkspaceClientId(client.id)}
                              >
                                {b("VAT", "ضريبة القيمة المضافة")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenBooks(client.id)}
                              disabled={switchMutation.isPending}
                            >
                              <BookOpen className="w-3.5 h-3.5 me-1" />
                              {b("Open", "فتح")}
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {clients.length > 12 && (
              <p className="text-xs text-muted-foreground mt-3">{t["firmOps.planMatrixMore"]}</p>
            )}
          </CardContent>
        </Card>
      )}

      <RevenueGrowthPanel onOpenClient={handleViewProfile} />

      <VatWorkspacePanel
        dashboard={bookkeeperDashboard}
        clients={clients}
        onOpenWorkspace={setVatWorkspaceClientId}
      />

      <OperationsBriefDialog
        client={briefClient}
        open={!!briefClientId}
        onOpenChange={(open) => !open && setBriefClientId(null)}
        onOpenBooks={handleOpenBooks}
        onViewProfile={handleViewProfile}
      />
      <VatWorkspaceDialog
        client={vatWorkspaceClient}
        ops={vatWorkspaceOps}
        open={!!vatWorkspaceClientId}
        onOpenChange={(open) => !open && setVatWorkspaceClientId(null)}
      />
    </div>
  );
}
