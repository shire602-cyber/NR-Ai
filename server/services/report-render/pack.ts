/**
 * Server-side report packs (W5-A, R12-01, R12-10, R12-09).
 *
 *   buildDeliveryPack   — the XLSX + PDF a delivery subscription sends
 *   buildStatementFile  — one statement as PDF or XLSX (statement download routes)
 *   buildSharePackZip   — accountant share pack: every statement, PDF + XLSX, zipped
 *
 * Ledger-based catalog reports are rendered from server/reporting. Document- and
 * snapshot-based indicator reports are not re-implemented server-side: the pack lists
 * them on a "Coverage" sheet with a link to open them in the app, so a recipient can see
 * exactly what the attachment does and does not contain.
 */
import JSZip from "jszip";
import { addMonths, monthEnd, monthStart, uaeToday } from "../../reporting";
import { reportCatalog, reportCatalogDataBasis } from "../../../client/src/lib/reportCatalog";
import {
  STATEMENT_KINDS,
  STATEMENT_TITLES,
  GL_PDF_LINE_CAP,
  loadRenderCompany,
  renderStatement,
  type StatementKind,
  type StatementPeriod,
} from "./statements";
import { buildReportPdf } from "./pdf";
import { buildReportWorkbook, type CoverageRow } from "./xlsx";
import type { RenderCompany, RenderedReport } from "./model";

/** Catalog report id → server-rendered statement. */
export const CATALOG_STATEMENT_KIND: Record<string, StatementKind> = {
  "profit-loss": "profit-loss",
  "balance-sheet": "balance-sheet",
  "cash-flow": "cash-flow",
  "trial-balance": "trial-balance",
  "general-ledger": "general-ledger",
  "account-transactions": "general-ledger",
  "ar-aging": "ar-aging",
  "customer-balances": "ar-aging",
  "ap-aging": "ap-aging",
  "vendor-balances": "ap-aging",
  "vat-summary": "vat-summary",
  "vat-return": "vat-summary",
};

export interface RenderedFile {
  kind: "pdf" | "xlsx" | "zip";
  filename: string;
  contentType: string;
  content: Buffer;
}

export const CONTENT_TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
} as const;

function slug(s: string): string {
  return (
    s
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "report"
  );
}

/** The reporting period a delivery covers, from its cadence (UAE calendar dates). */
export function deliveryPeriod(cadence: string, now = new Date()): StatementPeriod {
  const today = uaeToday(now);
  const c = cadence.toLowerCase();
  if (c.includes("month") || c.includes("tax") || c.includes("deadline")) {
    if (today === monthEnd(today)) return { from: monthStart(today), to: today };
    const prev = addMonths(monthStart(today), -1);
    return { from: prev, to: monthEnd(prev) };
  }
  return { from: monthStart(today), to: today };
}

export interface DeliveryPackResult {
  company: RenderCompany;
  period: StatementPeriod;
  statementKinds: StatementKind[];
  coverage: CoverageRow[];
  files: RenderedFile[];
  /** Full (untruncated) reports, e.g. for a Google Sheets copy. */
  reports: RenderedReport[];
}

export async function buildDeliveryPack(input: {
  companyId: string;
  title: string;
  reportIds: string[];
  period: StatementPeriod;
}): Promise<DeliveryPackResult> {
  const company = await loadRenderCompany(input.companyId);
  const kinds: StatementKind[] = ["executive-summary"];
  const coverage: CoverageRow[] = [];
  for (const reportId of input.reportIds) {
    const item = reportCatalog.find((r) => r.id === reportId);
    if (!item) continue;
    const kind = CATALOG_STATEMENT_KIND[reportId];
    if (kind && !kinds.includes(kind)) kinds.push(kind);
    if (reportId === "balance-sheet" && !kinds.includes("changes-in-equity")) {
      kinds.push("changes-in-equity");
    }
    coverage.push({
      reportId,
      name: item.name,
      status: kind ? "rendered" : "open_in_app",
      basis: reportCatalogDataBasis(reportId),
      link: kind ? null : (item.href ?? `/reports?report=${reportId}`),
    });
  }
  const pdfReports: RenderedReport[] = [];
  const xlsxReports: RenderedReport[] = [];
  for (const kind of kinds) {
    xlsxReports.push(await renderStatement(kind, company, input.period));
    pdfReports.push(
      kind === "general-ledger"
        ? await renderStatement(kind, company, input.period, { glLineCap: GL_PDF_LINE_CAP })
        : xlsxReports[xlsxReports.length - 1]
    );
  }
  const base = `${slug(input.title)}-${input.period.to}`;
  const [pdf, xlsx] = await Promise.all([
    buildReportPdf(company, pdfReports),
    buildReportWorkbook(company, xlsxReports, { title: input.title, coverage }),
  ]);
  return {
    company,
    period: input.period,
    statementKinds: kinds,
    coverage,
    reports: xlsxReports,
    files: [
      { kind: "pdf", filename: `${base}.pdf`, contentType: CONTENT_TYPES.pdf, content: pdf },
      { kind: "xlsx", filename: `${base}.xlsx`, contentType: CONTENT_TYPES.xlsx, content: xlsx },
    ],
  };
}

export async function buildStatementFile(input: {
  companyId: string;
  kind: StatementKind;
  period: StatementPeriod;
  format: "pdf" | "xlsx";
}): Promise<RenderedFile> {
  const company = await loadRenderCompany(input.companyId);
  const report = await renderStatement(input.kind, company, input.period, {
    glLineCap: input.format === "pdf" ? GL_PDF_LINE_CAP : undefined,
  });
  const base = `${input.kind}-${input.period.to}`;
  if (input.format === "pdf") {
    return {
      kind: "pdf",
      filename: `${base}.pdf`,
      contentType: CONTENT_TYPES.pdf,
      content: await buildReportPdf(company, [report]),
    };
  }
  return {
    kind: "xlsx",
    filename: `${base}.xlsx`,
    contentType: CONTENT_TYPES.xlsx,
    content: await buildReportWorkbook(company, [report], {
      title: STATEMENT_TITLES[input.kind].en,
    }),
  };
}

/** Accountant share pack: each statement as PDF and XLSX, plus a combined PDF, zipped. */
export async function buildSharePackZip(input: {
  companyId: string;
  period: StatementPeriod;
}): Promise<RenderedFile & { entries: string[] }> {
  const company = await loadRenderCompany(input.companyId);
  const zip = new JSZip();
  const entries: string[] = [];
  const all: RenderedReport[] = [];
  for (const kind of STATEMENT_KINDS) {
    const full = await renderStatement(kind, company, input.period);
    const forPdf =
      kind === "general-ledger"
        ? await renderStatement(kind, company, input.period, { glLineCap: GL_PDF_LINE_CAP })
        : full;
    all.push(forPdf);
    const pdf = await buildReportPdf(company, [forPdf]);
    const xlsx = await buildReportWorkbook(company, [full], { title: STATEMENT_TITLES[kind].en });
    zip.file(`pdf/${kind}.pdf`, pdf);
    zip.file(`xlsx/${kind}.xlsx`, xlsx);
    entries.push(`pdf/${kind}.pdf`, `xlsx/${kind}.xlsx`);
  }
  zip.file("financial-pack.pdf", await buildReportPdf(company, all));
  entries.push("financial-pack.pdf");
  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    kind: "zip",
    filename: `accountant-pack-${slug(company.name)}-${input.period.from}-${input.period.to}.zip`,
    contentType: CONTENT_TYPES.zip,
    content,
    entries,
  };
}
