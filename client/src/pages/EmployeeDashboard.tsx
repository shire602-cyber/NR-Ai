import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { downloadPdf } from "@/lib/download-pdf";
import { latestPayslipRun, leaveSummary, type BalanceLite, type RunLite } from "@/lib/employee-summary";
import { useI18n } from "@/lib/i18n";
import { messages as pageMessages } from "./EmployeeDashboard.i18n";

interface ItemLite {
  id: string;
}

/** What an employee-role user sees instead of the company dashboard: their own leave balance and latest payslip. */
export default function EmployeeDashboard() {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { data: me } = useCurrentUser();
  const [busy, setBusy] = useState(false);

  // Leave types give the names in the interface language (the balance rows carry only the code).
  const leaveTypes = useQuery<Array<{ code: string; nameEn: string; nameAr: string }>>({ queryKey: ["/api/companies", companyId, "leave-types"], enabled: !!companyId });
  const leaveName = (code: string) => {
    const t = leaveTypes.data?.find((x) => x.code === code);
    return t ? (tr.locale === "ar" ? t.nameAr : t.nameEn) : code;
  };
  const balances = useQuery<BalanceLite[]>({ queryKey: ["/api/companies", companyId, "leave-balances"], enabled: !!companyId });
  const runs = useQuery<RunLite[]>({ queryKey: ["/api/companies", companyId, "payroll-runs"], enabled: !!companyId });
  const run = latestPayslipRun(runs.data);
  const items = useQuery<ItemLite[]>({ queryKey: ["/api/payroll-runs", run?.id, "items"], enabled: !!run });
  const itemId = items.data?.[0]?.id;

  const month = run
    ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(run.period_year, run.period_month - 1, 1)))
    : "";

  async function download() {
    if (!run || !itemId) return;
    setBusy(true);
    try {
      await downloadPdf(`/api/payroll-runs/${run.id}/payslips/${itemId}/pdf`, "payslip.pdf");
    } catch {
      toast({ variant: "destructive", title: tr("downloadFailed") });
    } finally {
      setBusy(false);
    }
  }

  const leave = leaveSummary(balances.data);
  const loading = balances.isLoading || runs.isLoading;

  return (
    <div className="space-y-6" data-testid="employee-dashboard">
      <PageHeader eyebrow={tr("eyebrow")} title={me?.name ? tr("greeting", { name: me.name }) : tr("title")} description={tr("description")} />
      {loading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card data-testid="card-employee-leave">
          <CardHeader>
            <CardTitle className="text-lg">
              <h2>{tr("leaveTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!balances.isLoading && leave.length === 0 && <p className="text-sm text-muted-foreground">{tr("leaveNone")}</p>}
            <ul className="divide-y">
              {leave.map((l) => (
                <li key={l.code} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{leaveName(l.code)}</span>
                  <span className="tabular-nums">{tr("daysLeft", { days: l.days })}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm">
              <Link href="/payroll?tab=leave">{tr("myLeave")}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card data-testid="card-employee-payslip">
          <CardHeader>
            <CardTitle className="text-lg">
              <h2>{tr("payslipTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {run ? (
              <>
                <p className="text-sm">{tr("payslipFor", { month })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={download} disabled={busy || !itemId} data-testid="button-employee-payslip">
                    <Download className="me-2 h-4 w-4" aria-hidden="true" />
                    {tr("download")}
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/payroll">{tr("myPayroll")}</Link>
                  </Button>
                </div>
              </>
            ) : (
              !runs.isLoading && <p className="text-sm text-muted-foreground">{tr("payslipNone")}</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link href="/payroll?tab=loans">{tr("myLoans")}</Link>
      </Button>
    </div>
  );
}
