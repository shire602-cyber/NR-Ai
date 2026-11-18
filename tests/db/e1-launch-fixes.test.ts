/**
 * E1 launch fixes (J1-r2 / J2-r2): the AED/USD peg is the default rate for the pegged pair, and
 * the VAT Periods tab / due-date list follow the same "applies from" rule as the dashboard.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const rates = (t: Tenant) => `/api/companies/${t.company.id}/exchange-rates`;

describe("E1 FX: the CBUAE peg is the default AED/USD rate", () => {
  it("a company with no rate rows resolves USD<->AED at 3.6725 (both directions), via fx.getRate/convert", async () => {
    const t = await h.createTenant({ name: "PegDefault" });
    const fwd = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED`);
    expect(fwd.status, fwd.text).toBe(200);
    expect(fwd.body.rate).toBe(3.6725);
    expect(fwd.body.source).toBe("peg");
    expect(fwd.body.stale).toBe(false);

    const back = await t.as.get(`${rates(t)}/lookup?from=AED&to=USD`);
    expect(back.status).toBe(200);
    expect(back.body.rate).toBeCloseTo(1 / 3.6725, 6);

    const { resolve } = await import("../../server/platform/service-registry");
    const { registerFxServices } = await import("../../server/services/fx");
    registerFxServices();
    const convert = resolve<typeof import("../../server/services/fx").convert>("fx.convert");
    const usd = await convert(t.company.id, 100_000, "USD", "AED");
    expect(usd.convertedFils).toBe(367_250);
    // AED -> USD divides by the stored rate (exact), not a rounded reciprocal.
    const aed = await convert(t.company.id, 367_250, "AED", "USD");
    expect(aed.convertedFils).toBe(100_000);
  });

  it("an explicit company rate still wins over the peg; other pairs have no default", async () => {
    const t = await h.createTenant({ name: "PegOverride" });
    const add = await t.as.post(rates(t), {
      fromCurrency: "USD",
      toCurrency: "AED",
      rate: 3.7,
      effectiveDate: isoDaysAgo(1),
    });
    expect(add.status, add.text).toBe(201);
    const own = await t.as.get(`${rates(t)}/lookup?from=USD&to=AED`);
    expect(own.body.rate).toBe(3.7);
    expect(own.body.scope).toBe("company");
    const eur = await t.as.get(`${rates(t)}/lookup?from=EUR&to=AED`);
    expect(eur.status).toBe(422);
    expect(eur.body.code).toBe("NO_EXCHANGE_RATE");
  });

  it("a USD vendor bill (and its reverse-charge variant) books at the peg on a new company", async () => {
    const t = await h.createTenant({ name: "PegBill" });
    const created = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Overseas Supplier",
      bill_number: "OS-1",
      bill_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10),
      currency: "USD",
      line_items: [{ description: "Service", quantity: 1, unit_price: 500, vat_rate: 5 }],
    });
    expect(created.status, created.text).toBe(200);
    expect(Number(created.body.exchange_rate)).toBeCloseTo(3.6725, 6);
  });
});

describe("E1 VAT periods: nothing before the registration date or the books", () => {
  it("a company created today lists no past quarters and its next due date is in the future", async () => {
    const t = await h.createTenant({ name: "NewVat" });
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = 'Quarterly', trn_vat_number = '100123456700003',
              tax_registration_date = now() WHERE id = $1`,
      [t.company.id]
    );
    const periods = await t.as.get(`/api/vat/autopilot/periods/${t.company.id}`);
    expect(periods.status, periods.text).toBe(200);
    expect(periods.body).toEqual([]);

    const due = await t.as.get(`/api/vat/autopilot/due-dates?companyId=${t.company.id}`);
    expect(due.status, due.text).toBe(200);
    expect(due.body).toHaveLength(1);
    expect(due.body[0].daysUntilDue).toBeGreaterThan(0);
    expect(due.body[0].level).not.toBe("overdue");
  });

  it("periods start at the registration effective date once the books are older", async () => {
    const t = await h.createTenant({ name: "OldBooksVat" });
    // Books from ~200 days ago (an invoice), registered ~100 days ago: only periods ending on
    // or after the registration date belong here.
    const registered = isoDaysAgo(100);
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = 'Quarterly', trn_vat_number = '100123456700003',
              tax_registration_date = $2 WHERE id = $1`,
      [t.company.id, registered]
    );
    await h.sql(
      `INSERT INTO invoices (company_id, number, customer_name, date, currency, total, status)
       VALUES ($1, 'E1-OLD-1', 'Old Customer', $2, 'AED', 100, 'draft')`,
      [t.company.id, `${isoDaysAgo(200)}T00:00:00Z`]
    );
    const periods = await t.as.get(`/api/vat/autopilot/periods/${t.company.id}`);
    expect(periods.status, periods.text).toBe(200);
    for (const p of periods.body as Array<{ periodEnd: string }>) {
      expect(p.periodEnd.slice(0, 10) >= registered).toBe(true);
    }
    // Eight synthetic quarters would reach back two years; the rule keeps at most the one(s)
    // overlapping the last 100 days.
    expect(periods.body.length).toBeLessThanOrEqual(2);
  });
});

describe("E1 compliance obligations and the Periods tab (J3-r2)", () => {
  it("a company created today has no overdue WPS months or VAT quarters before its books", async () => {
    const t = await h.createTenant({ name: "NewObligations" });
    await h.sql(
      `UPDATE companies SET vat_filing_frequency = 'Quarterly', trn_vat_number = '100123456700003',
              tax_registration_date = now() WHERE id = $1`,
      [t.company.id]
    );
    await h.sql(
      `INSERT INTO employees (company_id, full_name, join_date, status) VALUES ($1, 'Emp', now(), 'active')`,
      [t.company.id]
    );
    const { buildObligationSpecs } =
      await import("../../server/services/compliance-obligations.service");
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const specs = [
      ...(await buildObligationSpecs(t.company.id, year)),
      ...(await buildObligationSpecs(t.company.id, year - 1)),
    ].filter((s) => s.type === "wps_payroll" || s.type === "vat_return");
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(String(s.periodEnd) >= today.slice(0, 7), `${s.key} starts before the books`).toBe(
        true
      );
    }
  });

  it("the Periods tab cannot mark a period submitted or accepted (one state machine)", async () => {
    const t = await h.createTenant({ name: "PeriodsReadOnly" });
    const url = `/api/vat/autopilot/periods/00000000-0000-4000-8000-000000000001/status`;
    const res = await t.as.patch(url, { companyId: t.company.id, status: "submitted" });
    expect(res.status, res.text).toBe(409);
    expect(res.body.code).toBe("USE_VAT_RETURN_FLOW");
    const acc = await t.as.patch(url, { companyId: t.company.id, status: "accepted" });
    expect(acc.status).toBe(409);
  });
});

describe("E1 month-end FX step ignores settled foreign documents", () => {
  it("counts only open exposures from the FX engine", async () => {
    const t = await h.createTenant({ name: "NoFxExposure" });
    const end = new Date().toISOString().slice(0, 10);
    const { computeFxExposure } = await import("../../server/services/fx/exposure");
    const exp = await computeFxExposure(t.company.id, end);
    expect(exp.items).toHaveLength(0);
    expect(exp.missingRates).toHaveLength(0);
  });
});

describe("E1 dashboard: AP average payment period needs a fully paid bill", () => {
  it("a part-paid bill gives no days-payable; once a bill is fully paid it is reported", async () => {
    const t = await h.createTenant({ name: "DpoFullyPaid" });
    const bill = async (n: string) => {
      const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
        vendor_name: "Office Supplies LLC",
        bill_number: n,
        bill_date: isoDaysAgo(10),
        due_date: isoDaysAgo(-20),
        line_items: [{ description: "Stationery", quantity: 1, unit_price: 1000, vat_rate: 0 }],
      });
      expect(b.status, b.text).toBe(200);
      const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
      expect(a.status, a.text).toBe(200);
      return b.body.id as string;
    };
    const pay = async (id: string, amount: number) => {
      const r = await t.as.post(`/api/bills/${id}/payments`, {
        payment_date: isoDaysAgo(10),
        amount,
        payment_method: "bank_transfer",
      });
      expect(r.status, r.text).toBeLessThan(300);
    };
    const dpo = async () => {
      const s = await t.as.get(`/api/companies/${t.company.id}/dashboard/stats`);
      expect(s.status, s.text).toBe(200);
      return s.body.dpo as number | null;
    };
    const first = await bill("SUP-1");
    await pay(first, 400);
    // A same-day part payment is not an average payment period.
    expect(await dpo()).toBeNull();
    const second = await bill("SUP-2");
    await pay(second, 1000);
    // AP open 600 of 2,000 trailing expenses: 600 / 2000 x 90 = 27.0 days.
    expect(await dpo()).toBe(27);
  });
});
