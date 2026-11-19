import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { apiRequest } from "@/lib/queryClient";
import type { BillingCycle, PaidPlanId } from "@shared/plans";

interface TrialRow {
  companyId: string;
  companyName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  trialEndsAt: string;
  trialEnded: boolean;
  chosenPlan: { planId: PaidPlanId; billingCycle: BillingCycle } | null;
  activationRequestedAt: string | null;
}

/**
 * NR admin overview: companies on a free trial (or ended in the last 30 days), the plan each
 * customer chose and any activation request, requests first. "Open" opens the company dialog,
 * where the chosen plan is applied in one click (AdminPlanControl).
 */
export function AdminTrialsCard({ onOpen }: { onOpen: (companyId: string) => void }) {
  const { t, locale } = useTranslation();
  const { data } = useQuery<{ trials: TrialRow[] }>({
    queryKey: ["/api/admin/billing/trials"],
    queryFn: () => apiRequest("GET", "/api/admin/billing/trials"),
    retry: false,
  });
  const rows = data?.trials ?? [];
  return (
    <Card data-testid="admin-trials">
      <CardHeader>
        <CardTitle className="text-base">{t["adminConsole.trialsTitle"]}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState size="sm" title={t["adminConsole.trialsEmpty"]} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-start text-muted-foreground">
                  <th className="py-2 pe-3 text-start font-medium">
                    {t["adminConsole.trialsColCompany"]}
                  </th>
                  <th className="py-2 pe-3 text-start font-medium">
                    {t["adminConsole.trialsColOwner"]}
                  </th>
                  <th className="py-2 pe-3 text-start font-medium">
                    {t["adminConsole.trialsColEnds"]}
                  </th>
                  <th className="py-2 pe-3 text-start font-medium">
                    {t["adminConsole.trialsColChoice"]}
                  </th>
                  <th className="py-2 pe-3 text-start font-medium">
                    {t["adminConsole.trialsColRequest"]}
                  </th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.companyId}
                    className="border-b last:border-0"
                    data-testid={`admin-trial-${r.companyId}`}
                  >
                    <td className="py-2 pe-3 font-medium">{r.companyName}</td>
                    <td className="py-2 pe-3">
                      <bdi>{r.ownerEmail ?? ""}</bdi>
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap tabular-nums">
                      {formatDate(r.trialEndsAt, locale)}
                      {r.trialEnded ? (
                        <span className="ms-2 text-caption text-muted-foreground">
                          {t["adminConsole.trialsEnded"]}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {r.chosenPlan
                        ? formatMessage(t["adminConsole.trialsChoiceValue"], {
                            plan: t[`marketing.prPlan_${r.chosenPlan.planId}`],
                            cycle:
                              t[
                                r.chosenPlan.billingCycle === "yearly"
                                  ? "marketing.prCycleYearly"
                                  : "marketing.prCycleMonthly"
                              ],
                          })
                        : "–"}
                    </td>
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {r.activationRequestedAt ? (
                        <Badge dot variant="warning">
                          {formatDate(r.activationRequestedAt, locale)}
                        </Badge>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="py-2 text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-9"
                        onClick={() => onOpen(r.companyId)}
                        data-testid={`admin-trial-open-${r.companyId}`}
                      >
                        {t["adminConsole.trialsOpen"]}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
