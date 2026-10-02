import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { renderPdf } from "../../server/reports/render/pdf";
import { renderXlsx } from "../../server/reports/render/xlsx";
import { reportCatalog } from "../../client/src/lib/reportCatalog";
import { reportNameAr } from "../../client/src/lib/reportCatalogI18n";
import { REPORT_DRILL_TARGETS, REPORT_PARAM_KINDS, type ReportResult } from "../../shared/report-result";
import "../../server/reports/definitions";
import { getReport, listReports, registeredReportIds } from "../../server/reports/registry";

// Phase 8 D4: the generic PDF and XLSX renderers, and registry / catalog parity.

const result = (rows: number, columns = 5): ReportResult => {
  const keys = ["code", "name", "debit", "credit", "balance", "extra", "more"].slice(0, columns);
  return {
    reportId: "general-ledger",
    title: { en: "General Ledger", ar: "دفتر الأستاذ العام" },
    companyId: "c1",
    currency: "AED",
    params: { from: "2026-01-01", to: "2026-03-31" },
    columns: keys.map((key, i) => ({
      key,
      label: { en: key === "name" ? "Account name" : `Col ${key}`, ar: key === "name" ? "اسم الحساب" : `عمود ${i}` },
      type: key === "code" || key === "name" || key === "extra" || key === "more" ? "text" : "money",
    })),
    rows: Array.from({ length: rows }, (_, i) => ({
      key: `r${i}`,
      kind: i % 40 === 0 ? ("section" as const) : ("detail" as const),
      depth: i % 40 === 0 ? 0 : 1,
      cells: { code: `10${i}`, name: i % 3 === 0 ? `حساب عربي ${i}` : `Account ${i}`, debit: i * 10, credit: i * 5, balance: i * 5, extra: "x", more: "y" },
    })),
    totals: { name: null, debit: 1234.5, credit: 617.25, balance: 617.25 },
    generatedAt: "2026-04-01T08:00:00.000Z",
  };
};

const text = (b: Buffer) => b.toString("latin1");
const pageCount = (b: Buffer) => (text(b).match(/\/Type \/Page\b/g) ?? []).length;
/** Decoded text of Helvetica strings (hex in TJ arrays) across all content streams. */
function latinStrings(buf: Buffer): string {
  const raw = text(buf);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      const s = inflateSync(buf.subarray(start, end)).toString("latin1");
      // pdfkit splits a string into kerned pieces inside one TJ array: join the pieces of each array.
      for (const arr of s.matchAll(/\[((?:<[0-9a-fA-F]*>|[-\d.\s])*)\]\s*TJ/g)) {
        out.push([...arr[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], "hex").toString("latin1")).join(""));
      }
      for (const one of s.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) out.push(Buffer.from(one[1], "hex").toString("latin1"));
    } catch {
      /* not flate */
    }
  }
  return out.join("\n");
}

describe("generic report PDF", () => {
  it("renders an English report as a PDF", async () => {
    const pdf = await renderPdf(result(30), "Acme LLC", "en");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pageCount(pdf)).toBe(1);
    const t = latinStrings(pdf);
    expect(t).toContain("General Ledger");
    expect(t).toContain("Acme LLC");
    expect(t).toContain("Page 1 / 1");
    expect(t).toContain("1,234.50");
  });

  it("repeats the column header on every page and numbers the pages", async () => {
    const pdf = await renderPdf(result(200), "Acme LLC", "en");
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(2);
    const t = latinStrings(pdf);
    expect((t.match(/Account name/g) ?? []).length).toBe(pages);
    expect(t).toContain(`Page ${pages} / ${pages}`);
  });

  it("goes landscape above six columns", async () => {
    const wide = await renderPdf(result(10, 7), "Acme", "en");
    const narrow = await renderPdf(result(10, 5), "Acme", "en");
    expect(text(wide)).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    expect(text(narrow)).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it("embeds Noto Sans Arabic for an Arabic report and mirrors the table", async () => {
    const en = await renderPdf(result(20), "Acme LLC", "en");
    const ar = await renderPdf(result(20), "شركة الأمل", "ar");
    expect(text(ar)).toContain("NotoSansArabic");
    expect(text(ar)).not.toEqual(text(en));
    expect(ar.subarray(0, 4).toString()).toBe("%PDF");
    // Western digits stay Western: the totals are drawn with the Latin font
    expect(latinStrings(ar)).toContain("1,234.50");
  });

  it("an English report does not drag in the Arabic font", async () => {
    const en = await renderPdf(result(5), "Acme LLC", "en");
    const noArabicRows: ReportResult = { ...result(5), rows: result(5).rows.map((r) => ({ ...r, cells: { ...r.cells, name: "Plain" } })) };
    expect(text(await renderPdf(noArabicRows, "Acme", "en"))).not.toContain("NotoSansArabic");
    expect(en.length).toBeGreaterThan(1000);
  });
});

describe("generic report XLSX", () => {
  it("writes a workbook (zip) with the report's columns", async () => {
    const xlsx = await renderXlsx(result(5), "en");
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const ar = await renderXlsx(result(5), "ar");
    expect(ar.subarray(0, 2).toString()).toBe("PK");
  });
});

describe("registry and catalog parity", () => {
  const live = reportCatalog.filter((r) => r.status === "live");

  it("every live catalog report has a server definition, and no definition lacks a live entry", () => {
    const registered = new Set(registeredReportIds());
    expect(live.filter((r) => !registered.has(r.id)).map((r) => r.id)).toEqual([]);
    expect([...registered].filter((id) => !live.some((r) => r.id === id))).toEqual([]);
    expect(live.length).toBe(67);
  });

  it("every live entry names params within range / asOf / comparison and a drill target", () => {
    for (const r of live) {
      expect(r.params?.length, r.id).toBeGreaterThan(0);
      for (const p of r.params!) expect(REPORT_PARAM_KINDS, r.id).toContain(p);
      expect(REPORT_DRILL_TARGETS, r.id).toContain(r.drillTarget);
      expect(r.href || r.tab, r.id).toBeTruthy();
    }
  });

  it("a comparison is only declared by definitions that can merge or own it", () => {
    for (const def of listReports()) {
      if (def.params.includes("comparison")) {
        const comparable = def.columns.some((c) => c.comparable) || def.ownComparison === true;
        expect(comparable, def.id).toBe(true);
      }
    }
  });

  it("every definition has an Arabic name, and every column an English and an Arabic label", () => {
    for (const def of listReports()) {
      expect(reportNameAr[def.id], def.id).toBeTruthy();
      expect(def.title.ar).not.toBe(def.title.en);
      for (const c of def.columns) {
        expect(c.label.en, `${def.id}.${c.key}`).toBeTruthy();
        expect(/[؀-ۿ]/.test(c.label.ar), `${def.id}.${c.key} Arabic label`).toBe(true);
      }
    }
  });

  it("sensitive reports are the payroll, leave, end-of-service and loan ones and the audit trail", () => {
    const sensitive = listReports().filter((d) => d.sensitive).map((d) => d.id).sort();
    expect(sensitive).toEqual(["audit-trail", "employee-loans", "eos-provision", "leave-balances", "payroll-register", "payroll-summary", "wps-sif-summary"]);
    expect(getReport("profit-loss")?.sensitive).toBeFalsy();
  });

  it("registering a definition without a catalog entry throws", async () => {
    const { registerReport } = await import("../../server/reports/registry");
    expect(() => registerReport({ id: "no-such-entry", columns: [], run: async () => ({ rows: [] }) })).toThrow(/no catalog entry/);
  });
});
