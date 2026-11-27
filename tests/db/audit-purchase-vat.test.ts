import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const domestic = { description: "Supplies", unit_price: 1000, vat_rate: 5 };
const reverseCharge = {
  description: "Imported service",
  unit_price: 1000,
  vat_rate: 5,
  vat_supply_type: "reverse_charge",
};

function registeredTenant() {
  return h.createTenant({
    companyColumns: { emirate: "dubai", trn_vat_number: "100222333400003" },
  });
}

async function bill(t: Tenant, fields: Record<string, unknown>) {
  const response = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Audit supplier",
    vendor_trn: "100000000000003",
    bill_number: "VAT-001",
    bill_date: "2026-01-15",
    save_as_draft: true,
    line_items: [domestic],
    ...fields,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

async function vatBoxes(t: Tenant, date = "2026-01-15") {
  const result = await t.as.get(
    `/api/companies/${t.company.id}/vat/compute?from=${date}&to=${date}`
  );
  expect(result.status, result.text).toBe(200);
  return result.body.boxes;
}

async function boxes(t: Tenant, billId: string, date?: string) {
  const submitted = await t.as.post(`/api/bills/${billId}/submit`, {});
  expect(submitted.status, submitted.text).toBe(200);
  const approved = await t.as.post(`/api/bills/${billId}/approve`, {});
  expect(approved.status, approved.text).toBe(200);
  return { approved: approved.body, vat: await vatBoxes(t, date) };
}

describe("Purchase VAT audit", () => {
  it.each([
    { encoding: "supply type", legacy: false },
    { encoding: "legacy flag", legacy: true },
  ])(
    "keeps partial and full edits equivalent for reverse charge stored as $encoding",
    async ({ legacy }) => {
      const t = await registeredTenant();
      const b = await bill(t, { line_items: [domestic, reverseCharge] });
      expect(b.total_amount).toBe("2050.00");
      await h.sql(
        `UPDATE bill_line_items
            SET vat_supply_type = CASE WHEN $2 THEN 'standard_rated' ELSE vat_supply_type END,
                reverse_charge = $2
          WHERE bill_id = $1 AND reverse_charge`,
        [b.id, legacy]
      );
      const edited = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
      expect(edited.status, edited.text).toBe(200);
      expect(edited.body.total_amount).toBe("2040.00");
      const { approved, vat } = await boxes(t, b.id);
      expect(approved.total_amount).toBe("2040.00");
      expect(vat).toMatchObject({
        box3ReverseChargeVat: 50,
        box9ExpensesVat: 50,
        box10ReverseChargeVat: 50,
      });
      const fullDate = "2026-01-16";
      const full = await bill(t, {
        bill_date: fullDate,
        bill_number: "VAT-FULL",
        withholding_amount: 10,
        line_items: [domestic, reverseCharge],
      });
      await h.sql(
        `UPDATE bill_line_items
            SET vat_supply_type = CASE WHEN $2 THEN 'standard_rated' ELSE vat_supply_type END,
                reverse_charge = $2
          WHERE bill_id = $1 AND reverse_charge`,
        [full.id, legacy]
      );
      // The editor submits the effective treatment for either stored encoding.
      const replaced = await t.as.patch(`/api/bills/${full.id}`, {
        line_items: [domestic, reverseCharge],
        notes: "Full edit",
      });
      expect(replaced.status, replaced.text).toBe(200);
      expect(replaced.body.total_amount).toBe(edited.body.total_amount);
      expect(replaced.body.vat_amount).toBe(edited.body.vat_amount);
      expect((await boxes(t, full.id, fullDate)).vat).toEqual(vat);
    }
  );

  it("preserves recorded amounts for a legacy rounded quantity and rejects new quantities that round to zero", async () => {
    const t = await registeredTenant();
    const b = await bill(t, { line_items: [domestic, { ...reverseCharge, unit_price: 4 }] });
    // Emulate an older bill entered at 0.004 × AED 1,000 before storage rounded quantity.
    await h.sql(
      "UPDATE bill_line_items SET quantity = 0, unit_price = 1000 WHERE bill_id = $1 AND reverse_charge",
      [b.id]
    );
    const savedLines = () =>
      h.sql("SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY id", [b.id]);
    const originalLines = await savedLines();
    const fractional = [domestic, { ...reverseCharge, quantity: 0.004 }];
    const create = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Audit supplier",
      bill_date: "2026-01-15",
      line_items: fractional,
    });
    expect(create.status, create.text).toBe(400);
    expect(create.body.code).toBe("INVALID_BILL_QUANTITY");
    const recurring = await t.as.post(`/api/companies/${t.company.id}/recurring-bills`, {
      name: "Fractional template",
      frequency: "monthly",
      next_run_on: "2026-01-15",
      template: { vendor_name: "Audit supplier", line_items: fractional },
    });
    expect(recurring.status, recurring.text).toBe(400);
    expect(recurring.body.code).toBe("INVALID_BILL_QUANTITY");
    const replace = await t.as.patch(`/api/bills/${b.id}`, { line_items: fractional });
    expect(replace.status, replace.text).toBe(400);
    expect(replace.body.code).toBe("INVALID_BILL_QUANTITY");

    const edited = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body).toMatchObject({
      subtotal: "1004.00",
      vat_amount: "50.20",
      total_amount: "1044.00",
    });
    expect(edited.body.line_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quantity: "0.00",
          unit_price: "1000.00",
          amount: "4.00",
          vat_amount: "0.20",
        }),
      ])
    );
    const { vat } = await boxes(t, b.id);
    expect(vat).toMatchObject({
      box3ReverseChargeVat: 0.2,
      box9ExpensesVat: 50,
      box10ReverseChargeVat: 0.2,
    });
    const revision = await t.as.post(`/api/bills/${b.id}/revise`, {
      reason: "Correct withholding",
      withholding_amount: 11,
    });
    expect(revision.status, revision.text).toBe(200);
    expect(revision.body).toMatchObject({
      subtotal: "1004.00",
      vat_amount: "50.20",
      total_amount: "1043.00",
    });
    expect(await savedLines()).toEqual(originalLines);
    expect(await vatBoxes(t)).toEqual(vat);
  });

  it.each([false, true])(
    "keeps saved lines, totals and VAT boxes on single-field PATCHes (customs: %s)",
    async (isImport) => {
      const t = await registeredTenant();
      const [account] = await h.sql<{ id: string }>(
        "SELECT id FROM accounts WHERE company_id = $1 AND code = '5050'",
        [t.company.id]
      );
      const fields = {
        currency: "USD",
        exchange_rate: "3.675123",
        is_import: isImport,
        customs_declaration_no: isImport ? "DXB-2026-0042" : null,
        import_vat_amount: isImport ? 60 : null,
        withholding_amount: 10,
        line_items: [
          { ...domestic, vat_rate: 0, account_id: account.id },
          { ...reverseCharge, quantity: 1.234, account_id: account.id },
        ],
      };
      const date = (i: number) => `2026-02-${String(i + 1).padStart(2, "0")}`;
      const baseline = await bill(t, { ...fields, bill_date: date(0) });
      const { vat } = await boxes(t, baseline.id, date(0));
      const patches = [
        { notes: "Updated metadata" },
        { due_date: "2026-03-20" },
        { category: "supplies" },
        { bill_number: "Renumbered" },
        { currency: "USD" },
        { withholding_amount: 10 },
        { is_import: isImport },
        { reverse_charge: isImport },
      ];
      for (const [i, patch] of patches.entries()) {
        const billDate = date(i + 1);
        const draft = await bill(t, { ...fields, bill_number: `SWEEP-${i}`, bill_date: billDate });
        const updated = await t.as.patch(`/api/bills/${draft.id}`, patch);
        expect(updated.status, updated.text).toBe(200);
        expect(updated.body.line_items, JSON.stringify(patch)).toEqual(draft.line_items);
        expect(updated.body).toMatchObject({
          subtotal: draft.subtotal,
          vat_amount: draft.vat_amount,
          total_amount: draft.total_amount,
          exchange_rate: draft.exchange_rate,
          import_vat_amount: draft.import_vat_amount,
        });
        expect((await boxes(t, draft.id, billDate)).vat, JSON.stringify(patch)).toEqual(vat);
      }
    }
  );

  it("uses the customs declaration after successive edits that omit import VAT", async () => {
    const t = await registeredTenant();
    const b = await bill(t, {
      is_import: true,
      customs_declaration_no: "DXB-2026-0042",
      import_vat_amount: 60,
    });
    expect(b.vat_amount).toBe("60.00");
    const first = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
    expect(first.status, first.text).toBe(200);
    expect(first.body.import_vat_amount).toBe("60.00");
    const second = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 20 });
    expect(second.status, second.text).toBe(200);
    expect(second.body).toMatchObject({ import_vat_amount: "60.00", vat_amount: "60.00" });
    const { vat } = await boxes(t, b.id);
    expect(vat).toMatchObject({ box6ImportsVat: 60, box10ReverseChargeVat: 60 });
  });
});
