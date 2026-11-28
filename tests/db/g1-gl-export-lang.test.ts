/**
 * STEP1 integrate-3: the tabular general-ledger export (`/reports/general-ledger/export`) takes
 * `lang=ar|en` (default: the company's language) and renders line text from the stored line keys,
 * with Arabic headings and dates for ar.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function sheetText(url: string, token: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${h.baseUrl}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) return { status: res.status, text: await res.text() };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.worksheets[0].eachRow((row) =>
    out.push(row.values ? (row.values as unknown[]).join("|") : "")
  );
  return { status: 200, text: out.join("\n") };
}

describe("GL tabular export language", () => {
  it("renders ar from line keys with Arabic dates/headings, en as stored, defaults to company locale", async () => {
    const t = await h.createTenant({ companyColumns: { locale: "ar" } });
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Palm Co",
      date: "2026-03-01",
      lines: [{ description: "Job", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const rev = await accountByCode(t, "4020");
    const q = (lang?: string) =>
      `${base(t)}/reports/general-ledger/export?accountIds=${rev.id}&from=2026-01-01&to=2026-12-31&format=xlsx${
        lang ? `&lang=${lang}` : ""
      }`;

    const ar = await sheetText(q("ar"), t.token);
    expect(ar.status).toBe(200);
    expect(ar.text).toContain("إيرادات المبيعات");
    expect(ar.text).toContain("مارس");
    expect(ar.text).toContain("التاريخ");
    expect(ar.text).toContain("الرصيد الختامي");
    expect(ar.text).not.toContain("Sales revenue");
    expect(ar.text).not.toContain("Closing balance");

    const en = await sheetText(q("en"), t.token);
    expect(en.text).toContain("Sales revenue");
    expect(en.text).toContain("2026-03-01");
    expect(en.text).toContain("Closing balance");

    // No lang: the company's own language (ar here).
    const dflt = await sheetText(q(), t.token);
    expect(dflt.text).toContain("إيرادات المبيعات");

    const bad = await t.as.get(q("fr"));
    expect(bad.status).toBe(400);
  });
});
