// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { T } from "@/components/layout/T";
import {
  ChevronRight,
  Calendar,
  BookOpen,
  AlertTriangle,
  Calculator,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BookkeeperClient } from "./types";
import {
  formatAed,
  formatDays,
  formatPeriod,
  hasClientService,
  ownerPreview,
} from "./helpers";
import { PriorityBadge, ServiceScopeBadges } from "./badges";
import { useFirmText } from "./text";

export function OperationsBriefDialog({
  client,
  open,
  onOpenChange,
  onOpenBooks,
  onViewProfile,
}: {
  client: BookkeeperClient | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBooks: (companyId: string) => void;
  onViewProfile: (companyId: string) => void;
}) {
  const { b, fx, fdShort } = useFirmText();
  const lanes = client
    ? [
        {
          key: "vat",
          service: "vat" as const,
          title: "VAT",
          icon: Calendar,
          status: client.vat.status,
          due: `${fdShort(client.vat.dueDate)} · ${fx(formatDays(client.vat.daysTilDue))}`,
          period: formatPeriod(client.vat.periodStart, client.vat.periodEnd),
          metric:
            client.vat.payableTax !== null
              ? formatAed(client.vat.payableTax)
              : fx(client.vat.cohortLabel),
          blockers: client.vat.blockers,
        },
        {
          key: "corporate-tax",
          service: "corporate_tax" as const,
          title: "Corporate Tax",
          icon: Calculator,
          status: client.corporateTax.status,
          due: `${fdShort(client.corporateTax.dueDate)} · ${fx(formatDays(client.corporateTax.daysTilDue))}`,
          period: formatPeriod(client.corporateTax.periodStart, client.corporateTax.periodEnd),
          metric:
            client.corporateTax.taxPayable !== null
              ? formatAed(client.corporateTax.taxPayable)
              : fx("Readiness"),
          blockers: client.corporateTax.blockers,
        },
        {
          key: "bookkeeping",
          service: "bookkeeping" as const,
          title: "Bookkeeping",
          icon: TrendingUp,
          status: client.bookkeeping.status,
          due: fx(`${client.bookkeeping.closeProgress}% close-ready`),
          period:
            client.bookkeeping.daysSinceActivity === null
              ? b("No activity date", "لا يوجد تاريخ نشاط")
              : fx(`${client.bookkeeping.daysSinceActivity}d since activity`),
          metric: `${client.bookkeeping.unpostedReceiptCount} ${b("receipts", "إيصالات")} · ${client.bookkeeping.unreconciledBankCount} ${b("bank lines", "بنود بنكية")}`,
          blockers: client.bookkeeping.blockers,
        },
        {
          key: "accounting",
          service: "accounting" as const,
          title: "Accounting",
          icon: CheckCircle2,
          status: client.accounting.status,
          due: client.accounting.trialBalanceBalanced
            ? b("Balanced", "متوازن")
            : b("Needs review", "يحتاج مراجعة"),
          period:
            client.accounting.discrepancy > 0
              ? formatAed(client.accounting.discrepancy)
              : b("No variance", "لا يوجد فرق"),
          metric: client.accounting.trialBalanceBalanced
            ? b("Trial balance clean", "ميزان المراجعة سليم")
            : b("Trial balance variance", "فرق في ميزان المراجعة"),
          blockers: client.accounting.blockers,
        },
      ].filter((lane) => hasClientService(client, lane.service))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {client?.companyName ?? b("Client Operations Brief", "ملخص عمليات العميل")}
          </DialogTitle>
          <DialogDescription>
            {client
              ? `${fx(ownerPreview(client.assignedStaff.map((staff) => staff.name)))} · ${fx(client.nextBestAction)}`
              : b("Operational status", "الحالة التشغيلية")}
          </DialogDescription>
        </DialogHeader>

        {client && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.priority" />
                </p>
                <div className="mt-1">
                  <PriorityBadge priority={client.priority} />
                </div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.owner" />
                </p>
                <p className="text-sm font-medium mt-1 truncate">
                  {fx(ownerPreview(client.assignedStaff.map((staff) => staff.name)))}
                </p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.lastActivity" />
                </p>
                <p className="text-sm font-medium mt-1">{fdShort(client.lastActivity)}</p>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  <T k="pages.openAr" />
                </p>
                <p className="text-sm font-medium mt-1">{formatAed(client.bookkeeping.openAr)}</p>
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                <T k="pages.nrServicesForThisClient" />
              </p>
              <ServiceScopeBadges services={client.serviceScope} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lanes.map((lane) => {
                const Icon = lane.icon;
                return (
                  <div key={lane.key} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-2">
                          <Icon className="w-4 h-4 text-primary" />
                          {fx(lane.title)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{fx(lane.period)}</p>
                      </div>
                      <PriorityBadge priority={lane.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          <T k="pages.timing" />
                        </p>
                        <p className="font-medium">{lane.due}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          <T k="pages.metric" />
                        </p>
                        <p className="font-medium truncate">{lane.metric}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {lane.blockers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          <T k="pages.noBlockers" />
                        </p>
                      ) : (
                        lane.blockers.slice(0, 4).map((blocker) => (
                          <div key={blocker} className="flex items-start gap-2 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
                            <span>{fx(blocker)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => client && onViewProfile(client.companyId)}
            disabled={!client}
          >
            <ChevronRight className="w-4 h-4 me-2" />
            <T k="pages.profile" />
          </Button>
          <Button onClick={() => client && onOpenBooks(client.companyId)} disabled={!client}>
            <BookOpen className="w-4 h-4 me-2" />
            <T k="pages.openBooks" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
