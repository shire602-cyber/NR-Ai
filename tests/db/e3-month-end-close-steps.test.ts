/**
 * E3 (J3-r3 Medium): month-end close.
 *  - "Sign off" on "Control accounts reconciled" answered 404 UNKNOWN_CLOSE_STEP: the checklist
 *    offers Sign off on every step it lists, but the sign-off route knew a shorter key list.
 *    Every key the checklist produces is now a sign-off key.
 *  - "VAT return prepared" blocked October although the quarter (Jul-Sep / Oct-Dec) was still
 *    open: only a month in which a VAT period ends needs a return, and the return counted is the
 *    one ending in that month (its stored end is the last instant of the day).
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const C = (t: Tenant) => `/api/companies/${t.company.id}/month-end`;

async function checklist(t: Tenant, period: string) {
  const r = await t.as.get(`${C(t)}/checklist?period=${period}`);
  expect(r.status, r.text).toBe(200);
  return r.body.checklist as Array<{
    key: string;
    status: string;
    effectiveStatus: string;
    details: string;
  }>;
}

const quarterly = {
  trn_vat_number: "100000000000003",
  emirate: "dubai",
  vat_filing_frequency: "Quarterly",
  vat_period_start_month: 1,
};

describe("E3 (J3-r3) month-end close steps", () => {
  it("every step the checklist offers can be signed off (control_accounts no longer 404s)", async () => {
    const t = await h.createTenant({ companyColumns: quarterly });
    // INTEGRATE-H: a documents-mode opening TB still waiting for its open invoices adds D1's
    // go-live step (opening_balances, id 12), so it is signed off here as well.
    const b = await t.as.post(`/api/companies/${t.company.id}/bank-accounts`, {
      nameEn: "ENBD",
      bankName: "Emirates NBD",
      currency: "AED",
    });
    expect(b.status, b.text).toBeLessThan(300);
    const bankCode = (
      await h.sql<{ code: string }>(`SELECT code FROM accounts WHERE id = $1`, [b.body.glAccountId])
    )[0].code;
    const p = await t.as.post(`/api/companies/${t.company.id}/imports/preview`, {
      sourceSystem: "generic",
      kind: "trial_balance",
      cutOverDate: "2026-09-30",
      arApMode: "documents",
      csv: [
        "Account Code,Account Name,Debit,Credit",
        `${bankCode},Bank,50000,`,
        "1040,Accounts Receivable,10500,",
        "3010,Capital,,60500",
      ].join("\n"),
    });
    expect(p.status, p.text).toBe(201);
    const v = await t.as.post(`/api/companies/${t.company.id}/imports/${p.body.id}/validate`, {});
    expect(v.body.status, JSON.stringify(v.body.issues)).toBe("validated");
    const cm = await t.as.post(`/api/companies/${t.company.id}/imports/${p.body.id}/commit`, {});
    expect(cm.status, cm.text).toBe(200);

    const items = await checklist(t, "2026-10");
    expect(items.map((i) => i.key)).toContain("control_accounts");
    expect(items.find((i) => i.key === "opening_balances")).toMatchObject({ status: "incomplete" });
    for (const item of items) {
      expect(item.key, JSON.stringify(item)).toBeTruthy();
      const r = await t.as.post(`${C(t)}/steps/${item.key}/sign-off`, {
        period: "2026-10",
        note: "Reviewed",
      });
      expect(r.status, `${item.key}: ${r.text}`).toBe(201);
    }
    const after = await checklist(t, "2026-10");
    expect(after.every((i) => i.effectiveStatus === "complete")).toBe(true);
    const withdraw = await t.as.delete(`${C(t)}/steps/control_accounts/sign-off?period=2026-10`);
    expect(withdraw.status, withdraw.text).toBeLessThan(300);
  });

  it("October inside an open quarter needs no VAT return; September (quarter end) does", async () => {
    const t = await h.createTenant({ companyColumns: quarterly });
    const vat = async (period: string) =>
      (await checklist(t, period)).find((i) => i.key === "vat_return")!;

    const oct = await vat("2026-10");
    expect(oct.status).toBe("complete");
    expect(oct.details).toBe("No VAT return due this month: the VAT period ends 2026-12-31");
    const aug = await vat("2026-08");
    expect(aug.status).toBe("complete");

    const sep = await vat("2026-09");
    expect(sep.status).toBe("incomplete");
    expect(sep.details).toBe("No VAT return prepared for this period");

    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, {
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(gen.status, gen.text).toBe(201);
    // A draft is not "prepared"; marking it ready is.
    expect((await vat("2026-09")).status).toBe("incomplete");
    const ready = await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
    expect(ready.status, ready.text).toBe(200);
    const done = await vat("2026-09");
    expect(done.status).toBe("complete");
    expect(done.details).toBe("1 VAT return(s) prepared");
  });

  it("a monthly filer needs a return every month", async () => {
    const t = await h.createTenant({
      companyColumns: { ...quarterly, vat_filing_frequency: "Monthly" },
    });
    const items = await checklist(t, "2026-10");
    expect(items.find((i) => i.key === "vat_return")!.status).toBe("incomplete");
  });

  it("a company that is not VAT registered has no VAT step to complete", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: null, tax_registration_type: "Non-registered" },
    });
    const item = (await checklist(t, "2026-09")).find((i) => i.key === "vat_return")!;
    expect(item.status).toBe("complete");
    expect(item.details).toBe("Not VAT registered: no VAT return to prepare");
  });
});
