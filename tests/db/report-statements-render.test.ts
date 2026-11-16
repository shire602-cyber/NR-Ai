/**
 * W5-A server-rendered statements (R11-12, R12-09, R12-10) on the real app + Postgres.
 *
 * - Statement of changes in equity ties to the balance sheet on the golden books.
 * - Statement PDF/XLSX are produced server-side (XLSX cells numeric).
 * - An ar-locale company gets Arabic labels in its PDF.
 * - Executive summary and the accountant share pack (zip) come from the reporting kernel.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { postJournalEntry, useHarness } from "./harness";
import { GOLDEN_EXPECTED, seedGoldenBooksFY2025_2026 } from "./golden/seed";
import { pdfToText } from "../unit/pdf-test-helpers";

const h = useHarness();
const FY2026 = { from: "2026-01-01", to: "2026-10-31" };

describe("W5-A statement outputs", () => {
  it("[R12-09] changes in equity ties to the balance sheet for the golden books", async () => {
    const t = await h.createTenant({ name: "Golden Equity" });
    await seedGoldenBooksFY2025_2026(t);
    const r = await t.as.get(
      `/api/companies/${t.company.id}/reports/changes-in-equity?from=${FY2026.from}&to=${FY2026.to}`
    );
    expect(r.status, r.text).toBe(200);
    const e = r.body;
    expect(e.opening.total).toBeCloseTo(GOLDEN_EXPECTED.fy2025.totalEquity, 2);
    expect(e.opening.capital).toBeCloseTo(GOLDEN_EXPECTED.fy2025.capital, 2);
    expect(e.capitalMovements).toBe(0);
    expect(e.otherRetainedEarningsMovements).toBeCloseTo(0, 2);
    const bs = await t.as.get(
      `/api/companies/${t.company.id}/reports/balance-sheet?asOf=${FY2026.to}`
    );
    expect(bs.status, bs.text).toBe(200);
    expect(e.closing.total).toBeCloseTo(bs.body.totalEquity, 2);
    expect(e.balanceSheetTotalEquity).toBeCloseTo(bs.body.totalEquity, 2);
    expect(e.opening.total + e.profitForPeriod).toBeCloseTo(e.closing.total, 2);
    expect(e.ties).toBe(true);

    const pl = await t.as.get(
      `/api/companies/${t.company.id}/reports/profit-loss?from=${FY2026.from}&to=${FY2026.to}`
    );
    expect(e.profitForPeriod).toBeCloseTo(pl.body.netProfit, 2);

    const rendered = await t.as.get(
      `/api/companies/${t.company.id}/reports/statements/changes-in-equity?format=json&from=${FY2026.from}&to=${FY2026.to}`
    );
    expect(rendered.status, rendered.text).toBe(200);
    expect(rendered.body.basis).toBe("ledger");
    const closingRow = rendered.body.tables[0].rows.at(-1);
    expect(closingRow.cells.total).toBeCloseTo(bs.body.totalEquity, 2);
  });

  it("[R11-12] statement XLSX has numeric cells equal to the kernel figures; PDF is generated", async () => {
    const t = await h.createTenant();
    await postJournalEntry(t, {
      date: "2026-03-10",
      description: "Capital",
      lines: [
        { code: "1020", debit: 5000 },
        { code: "3010", credit: 5000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2026-03-11",
      description: "Consulting",
      lines: [
        { code: "1020", debit: 1234.56 },
        { code: "4010", credit: 1234.56 },
      ],
    });
    const { buildStatementFile } = await import("../../server/services/report-render/pack");
    for (const kind of [
      "profit-loss",
      "balance-sheet",
      "trial-balance",
      "cash-flow",
      "general-ledger",
      "ar-aging",
      "ap-aging",
      "executive-summary",
    ] as const) {
      const pdf = await buildStatementFile({
        companyId: t.company.id,
        kind,
        period: { from: "2026-03-01", to: "2026-03-31" },
        format: "pdf",
      });
      expect(pdf.content.subarray(0, 4).toString()).toBe("%PDF");
    }
    const xlsx = await buildStatementFile({
      companyId: t.company.id,
      kind: "profit-loss",
      period: { from: "2026-03-01", to: "2026-03-31" },
      format: "xlsx",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.content as never);
    const values: unknown[] = [];
    wb.worksheets[0].eachRow((row) => values.push(row.getCell(3).value));
    expect(values).toContain(1234.56);
    expect(values.filter((v) => typeof v === "string" && /^\d/.test(v as string))).toHaveLength(0);

    const pdfText = await pdfToText(
      (
        await buildStatementFile({
          companyId: t.company.id,
          kind: "profit-loss",
          period: { from: "2026-03-01", to: "2026-03-31" },
          format: "pdf",
        })
      ).content
    );
    expect(pdfText).toContain("Profit and Loss");
    expect(pdfText).toContain("1,234.56");
  });

  it("[R11-12] ar-locale company PDF carries Arabic labels", async () => {
    const t = await h.createTenant({ companyColumns: { locale: "ar" } });
    await postJournalEntry(t, {
      date: "2026-04-02",
      description: "Sale",
      lines: [
        { code: "1020", debit: 800 },
        { code: "4010", credit: 800 },
      ],
    });
    const { buildStatementFile } = await import("../../server/services/report-render/pack");
    const pdf = await buildStatementFile({
      companyId: t.company.id,
      kind: "profit-loss",
      period: { from: "2026-04-01", to: "2026-04-30" },
      format: "pdf",
    });
    const text = (await pdfToText(pdf.content)).replace(/\s+/g, " ");
    expect(text).toContain("قائمة الأرباح والخسائر");
    expect(text).toContain("صافي الربح");
    expect(text).toContain("800.00");
  });

  it("[R12-09] executive summary and the accountant share pack come from the ledger", async () => {
    const t = await h.createTenant();
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Overdue Customer",
      date: "2026-05-01",
      dueDate: "2026-05-15",
      lines: [{ description: "Work", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const s = await t.as.get(
      `/api/companies/${t.company.id}/reports/executive-summary?from=2026-05-01&to=2026-06-30`
    );
    expect(s.status, s.text).toBe(200);
    expect(s.body.revenue).toBeCloseTo(2000, 2);
    expect(s.body.receivables).toBeCloseTo(2100, 2);
    expect(s.body.overdueReceivables).toBeCloseTo(2100, 2);
    expect(s.body.topOverdue[0]).toMatchObject({ name: "Overdue Customer" });

    const { buildSharePackZip } = await import("../../server/services/report-render/pack");
    const zip = await buildSharePackZip({
      companyId: t.company.id,
      period: { from: "2026-05-01", to: "2026-06-30" },
    });
    const files = Object.keys((await JSZip.loadAsync(zip.content)).files);
    expect(files).toEqual(
      expect.arrayContaining([
        "pdf/profit-loss.pdf",
        "xlsx/balance-sheet.xlsx",
        "pdf/changes-in-equity.pdf",
        "pdf/executive-summary.pdf",
        "financial-pack.pdf",
      ])
    );

    const bad = await t.as.get(`/api/companies/${t.company.id}/reports/statements/nope`);
    expect(bad.status).toBe(404);
    const other = await h.createSecondTenant();
    const leak = await other.as.get(
      `/api/companies/${t.company.id}/reports/statements/profit-loss?format=json`
    );
    expect([403, 404]).toContain(leak.status);
  });
});
