import { T } from "@/components/layout/T";
import { Banknote, CalendarDays, FileText, Landmark, LogOut, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useHr } from "./payroll/shared";
import { EmployeesTab } from "./payroll/EmployeesTab";
import { RunsTab } from "./payroll/RunsTab";
import { LeaveTab } from "./payroll/LeaveTab";
import { PayslipsTab } from "./payroll/PayslipsTab";
import { SettlementTab } from "./payroll/SettlementTab";
import { WpsTab } from "./payroll/WpsTab";

/**
 * Payroll & WPS (W3-D): runs, employees, leave, payslips, end-of-service
 * settlement and WPS. Each tab lives in client/src/pages/payroll/.
 */
export default function Payroll() {
  const { tx } = useHr();
  const { companyId, isLoading } = useDefaultCompany();

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

  const tabs = [
    { value: "runs", label: "hr.tab.runs", icon: Banknote },
    { value: "employees", label: "hr.tab.employees", icon: Users },
    { value: "leave", label: "hr.tab.leave", icon: CalendarDays },
    { value: "payslips", label: "hr.tab.payslips", icon: FileText },
    { value: "settlement", label: "hr.tab.settlement", icon: LogOut },
    { value: "wps", label: "hr.tab.wps", icon: Landmark },
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
      </Tabs>
    </div>
  );
}
