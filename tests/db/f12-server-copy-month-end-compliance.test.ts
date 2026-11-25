/**
 * F12: month-end checklist copy and compliance-calendar legal citations are described as stable
 * keys + params next to the English text the API keeps writing, on the real app + Postgres.
 * Legacy stored English (calendar rows written before keys existed) maps back to keys on read.
 */
import { describe, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";
import enCatalog from "../../client/src/locales/en/components.json";
import arCatalog from "../../client/src/locales/ar/components.json";
import { localizeServerText, serverCopyCatalogKey } from "../../shared/server-copy";

const h = useHarness();
const ar = arCatalog as Record<string, string>;
const en = enCatalog as Record<string, string>;

type Copy = { key: string; params: Record<string, string> } | null;

describe("F12 month-end checklist copy keys", () => {
  it("every title, description and details line carries a key and renders in Arabic", async () => {
    const t = await h.createTenant({ name: "MonthEndCopy" });
    const res = await t.as.get(`/api/companies/${t.company.id}/month-end/checklist?period=2026-10`);
    expect(res.status, res.text).toBe(200);
    const items = res.body.checklist as Array<{
      title: string;
      description: string;
      details?: string;
      copy: { title: Copy; description: Copy; details: Copy };
    }>;
    expect(items.length).toBeGreaterThanOrEqual(10);
    for (const item of items) {
      expect(item.copy.title, item.title).not.toBeNull();
      expect(item.copy.description, item.description).not.toBeNull();
      if (item.details) expect(item.copy.details, item.details).not.toBeNull();
      // The English text is unchanged and the Arabic catalog renders a real sentence.
      for (const [text, copy] of [
        [item.title, item.copy.title],
        [item.description, item.copy.description],
        [item.details, item.copy.details],
      ] as const) {
        if (!text || !copy) continue;
        expect(en[serverCopyCatalogKey(copy.key)], copy.key).toBeTruthy();
        const arabic = localizeServerText(text, ar, copy);
        expect(arabic, copy.key).toMatch(/[؀-ۿ]/);
        expect(arabic, copy.key).not.toMatch(/\{\w+\}/);
      }
    }
    // A concrete step: no bank rows in an empty company.
    const bank = items.find((i) => i.title === "Bank reconciliation complete")!;
    expect(bank.copy.details).toEqual({ key: "monthEnd.bank.none", params: {} });
  });

  it("computed close memo and message carry keys", async () => {
    const t = await h.createTenant({ name: "MonthEndMemo" });
    const res = await t.as.post(
      `/api/companies/${t.company.id}/month-end/generate-closing-entries`,
      {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
      }
    );
    expect(res.status, res.text).toBeLessThan(300);
    expect(res.body.copy.memo).toEqual({
      key: "monthEnd.closeMemo",
      params: { start: "2026-10-01", end: "2026-10-31" },
    });
    expect(res.body.copy.message.key).toBe("monthEnd.closeMessage");
  });
});

describe("F12 compliance calendar legal citations", () => {
  it("generated rows expose legalSourceCopy; stored legacy English maps to the same key", async () => {
    const restore = freezeTime("2026-06-01T08:00:00Z");
    try {
      const t = await h.createTenant({
        name: "LegalCopy",
        companyColumns: {
          trn_vat_number: "100000000000003",
          vat_filing_frequency: "Quarterly",
          vat_period_start_month: 1,
          // X5 (J1 D4): returns apply from the books start; this company keeps books since 2025.
          created_at: "2025-01-01T00:00:00Z",
        },
      });
      const gen = await t.as.post(`/api/companies/${t.company.id}/compliance-calendar/generate`, {
        year: 2026,
      });
      expect(gen.status, gen.text).toBe(200);
      const list = await t.as.get(
        `/api/companies/${t.company.id}/compliance-calendar?from=2026-01-01&to=2026-12-31&generate=false`
      );
      const rows = list.body as Array<{
        obligationType: string;
        legalSource: string | null;
        legalSourceCopy: Copy;
      }>;
      const vat = rows.find((r) => r.obligationType === "vat_return")!;
      expect(vat.legalSource).toBe("FDL 8/2017 Art. 64; Executive Regulation Art. 59 (28 days)");
      expect(vat.legalSourceCopy).toEqual({ key: "legal.vatReturn", params: {} });
      const ct = rows.find((r) => r.obligationType === "corporate_tax_return")!;
      expect(ct.legalSourceCopy?.key).toBe("legal.ctReturn");

      // Every generated row's citation is known; the Arabic keeps the law and article numbers.
      for (const r of rows.filter((x) => x.legalSource)) {
        expect(r.legalSourceCopy, r.legalSource ?? "").not.toBeNull();
        const arabic = localizeServerText(r.legalSource, ar);
        expect(arabic).toMatch(/[؀-ۿ]/);
      }
      expect(localizeServerText(vat.legalSource, ar)).toContain("(8) لسنة 2017");
      expect(localizeServerText(vat.legalSource, ar)).toContain("(64)");
      expect(localizeServerText(ct.legalSource, ar)).toContain("(47) لسنة 2022");

      // A row written by an older build (plain English) still maps on read.
      await h.sql(
        `UPDATE compliance_calendar SET legal_source = 'Cabinet Decision 58/2020 (UBO register; update within 15 days of change)'
          WHERE company_id = $1 AND obligation_type = 'ubo_confirmation'`,
        [t.company.id]
      );
      const again = await t.as.get(
        `/api/companies/${t.company.id}/compliance-calendar?from=2026-01-01&to=2026-12-31&generate=false`
      );
      const ubo = (again.body as Array<{ obligationType: string; legalSourceCopy: Copy }>).find(
        (r) => r.obligationType === "ubo_confirmation"
      );
      if (ubo) expect(ubo.legalSourceCopy?.key).toBe("legal.ubo");
    } finally {
      restore();
    }
  });
});
