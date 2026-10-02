import { useState } from "react";
import { Download, FileSpreadsheet, FileText, FileType } from "lucide-react";
import type { ReportFileFormat, ReportParamKind } from "@shared/report-result";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { downloadReportFile, type ReportViewState } from "@/lib/reportRunApi";
import { messages as pageMessages } from "./ReportExportMenu.i18n";

interface Props {
  companyId: string | undefined;
  reportId: string;
  reportName: string;
  kinds: readonly ReportParamKind[];
  state: ReportViewState;
  disabled?: boolean;
  variant?: "outline" | "default";
  /** Which edge of the button the menu lines up with (the page header is on the end edge; the Reports page on the start). */
  align?: "start" | "end";
}

/**
 * PDF / CSV / XLSX through the run route. The server renders the file from the same rows the table shows, in the
 * language the person is using; nothing is computed in the browser.
 */
export function ReportExportMenu({
  companyId,
  reportId,
  reportName,
  kinds,
  state,
  disabled,
  variant = "outline",
  align = "end",
}: Props) {
  const tr = pageMessages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState<ReportFileFormat | null>(null);

  const formatLabel: Record<ReportFileFormat, string> = {
    pdf: tr("asPdf"),
    csv: tr("asCsv"),
    xlsx: tr("asXlsx"),
  };

  const run = async (format: ReportFileFormat) => {
    if (!companyId || busy) return;
    setBusy(format);
    try {
      await downloadReportFile(
        companyId,
        reportId,
        kinds,
        state,
        format,
        locale === "ar" ? "ar" : "en"
      );
      toast({
        title: tr("downloaded"),
        description: tr("downloadedDescription", {
          report: reportName,
          format: formatLabel[format],
        }),
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: tr("failed"), description: error?.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          disabled={disabled || !companyId || busy !== null}
          data-testid="button-report-download"
        >
          <Download className="me-2 h-4 w-4" />
          {busy ? tr("preparing") : tr("download")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuItem onClick={() => run("pdf")} data-testid="menu-download-pdf">
          <FileType className="me-2 h-4 w-4" />
          {formatLabel.pdf}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("csv")} data-testid="menu-download-csv">
          <FileText className="me-2 h-4 w-4" />
          {formatLabel.csv}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("xlsx")} data-testid="menu-download-xlsx">
          <FileSpreadsheet className="me-2 h-4 w-4" />
          {formatLabel.xlsx}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {tr("serverNote")}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
