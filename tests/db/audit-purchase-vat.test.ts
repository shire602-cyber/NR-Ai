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

async function boxes(t: Tenant, billId: string) {
  const submitted = await t.as.post(`/api/bills/${billId}/submit`, {});
  expect(submitted.status, submitted.text).toBe(200);
  const approved = await t.as.post(`/api/bills/${billId}/approve`, {});
  expect(approved.status, approved.text).toBe(200);
  const result = await t.as.get(
    `/api/companies/${t.company.id}/vat/compute?from=2026-01-01&to=2026-03-31`
  );
  expect(result.status, result.text).toBe(200);
  return { approved: approved.body, vat: result.body.boxes };
}

describe("Purchase VAT audit", () => {
  it.each([
    { encoding: "supply type", legacy: false },
    { encoding: "legacy flag", legacy: true },
  ])(
    "retains line-level reverse charge stored as $encoding when only withholding changes",
    async ({ legacy }) => {
      const t = await registeredTenant();
      const b = await bill(t, { line_items: [domestic, reverseCharge] });
      expect(b.total_amount).toBe("2050.00");
      if (legacy) {
        await h.sql(
          `UPDATE bill_line_items SET vat_supply_type = 'standard_rated'
          WHERE bill_id = $1 AND reverse_charge`,
          [b.id]
        );
      }
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
