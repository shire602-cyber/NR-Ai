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
  const { preferredReportWorkspace } = m;
  return (
    <section data-testid="dashboard-report-workspace">
      <SectionHeader
        eyebrow="Reports"
        title={preferredReportWorkspace.navLabel}
        action={
          <Link href={reportWorkspaceHref(preferredReportWorkspace)}>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-accent hover:text-accent -me-2"
              data-testid="dashboard-open-report-workspace"
            >
              <T k="reportCenter.openWorkspace" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        }
      />
      <Card className="border-card-border overflow-hidden">
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
