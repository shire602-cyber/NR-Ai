import { T } from "@/components/layout/T";
import { Banknote, CalendarDays, FileText, Landmark, LogOut, PiggyBank, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useTranslation } from "@/lib/i18n";
import { useHr } from "./payroll/shared";
import { EmployeesTab } from "./payroll/EmployeesTab";
import { RunsTab } from "./payroll/RunsTab";
import { LeaveTab } from "./payroll/LeaveTab";
import { PayslipsTab } from "./payroll/PayslipsTab";
import { SettlementTab } from "./payroll/SettlementTab";
import { WpsTab } from "./payroll/WpsTab";
import { PensionTab } from "./payroll/PensionTab";

/**
 * Payroll & WPS (W3-D): runs, employees, leave, payslips, end-of-service
 * settlement and WPS. Each tab lives in client/src/pages/payroll/.
 */
export default function Payroll() {
  const { tx } = useHr();
  const { companyId, isLoading } = useDefaultCompany();
  const { canRead } = useCompanyPermission();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        {tx("hr.loading")}
      </div>
    );
  }
  if (!companyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <T k="pages.pleaseCreateACompanyFirst" />
      </div>
    );
  }

  // X6b: payroll data needs payroll.manage or payroll.approve; a viewer gets a notice, not 403s.
  if (!canRead("payroll.manage") && !canRead("payroll.approve")) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="HR & Payroll" title={tx("hr.title")} description={tx("hr.subtitle")} />
        <div
          role="note"
          data-testid="payroll-no-access"
          className="rounded-lg border bg-muted/40 p-4 text-sm"
        >
          <p className="font-medium">{t["pages.payrollNoAccessTitle"]}</p>
          <p className="mt-1 text-muted-foreground">{t["pages.payrollNoAccessBody"]}</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { value: "runs", label: "hr.tab.runs", icon: Banknote },
    { value: "employees", label: "hr.tab.employees", icon: Users },
    { value: "leave", label: "hr.tab.leave", icon: CalendarDays },
    { value: "payslips", label: "hr.tab.payslips", icon: FileText },
    { value: "settlement", label: "hr.tab.settlement", icon: LogOut },
    { value: "wps", label: "hr.tab.wps", icon: Landmark },
    { value: "pension", label: "hr.tab.pension", icon: PiggyBank },
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="HR & Payroll" title={tx("hr.title")} description={tx("hr.subtitle")} />
      <Tabs defaultValue="runs" className="space-y-4">
        <TabsList>
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon aria-hidden />
              {tx(label)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="runs">
          <RunsTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="employees">
          <EmployeesTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="leave">
          <LeaveTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="payslips">
          <PayslipsTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="settlement">
          <SettlementTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="wps">
          <WpsTab companyId={companyId} />
        </TabsContent>
        <TabsContent value="pension">
          <PensionTab companyId={companyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
