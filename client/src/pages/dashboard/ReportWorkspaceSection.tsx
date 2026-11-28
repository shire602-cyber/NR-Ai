import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { reportWorkspaceHref } from "@/lib/reportCatalog";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { SectionHeader } from "./Layout";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";
import { ReportWorkspacePartA } from "./ReportWorkspaceA";
import { ReportWorkspacePartB } from "./ReportWorkspaceB";
import { ReportWorkspacePartC } from "./ReportWorkspaceC";
import { ReportWorkspacePartD } from "./ReportWorkspaceD";
import { ReportWorkspacePartE } from "./ReportWorkspaceE";
import { ReportWorkspacePartF } from "./ReportWorkspaceF";

export function ReportWorkspaceSection({ m }: { m: DashboardModel }) {
  const { preferredReportWorkspace, t } = m;
  return (
    <section data-testid="dashboard-report-workspace">
      <SectionHeader
        eyebrow={t["shell.navReports"]}
        title={preferredReportWorkspace.navLabel}
        action={
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-me-2 text-accent hover:text-accent"
            data-testid="dashboard-open-report-workspace"
          >
            <Link href={reportWorkspaceHref(preferredReportWorkspace)}>
              <T k="reportCenter.openWorkspace" />
              <ArrowRight className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <ReportWorkspacePartA m={m} />
          <ReportWorkspacePartB m={m} />
          <ReportWorkspacePartC m={m} />
          <ReportWorkspacePartD m={m} />
          <ReportWorkspacePartE m={m} />
          <ReportWorkspacePartF m={m} />
        </CardContent>
      </Card>
    </section>
  );
}
