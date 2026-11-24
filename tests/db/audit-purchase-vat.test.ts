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
    companyColumns: { emirate: "dubai" },
  });
}

async function bill(t: Tenant, fields: Record<string, unknown>) {
  const response = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Audit supplier",
    vendor_trn: "100000000000003",
    bill_number: "VAT-001",
    bill_date: "2026-01-15",
    line_items: [domestic],
    ...fields,
  });
  expect(response.status, response.text).toBe(200);
  return response.body;
}

async function boxes(t: Tenant, billId: string) {
  const approved = await t.as.post(`/api/bills/${billId}/approve`, {});
  expect(approved.status, approved.text).toBe(200);
  const result = await t.as.get(
    `/api/companies/${t.company.id}/vat/compute?from=2026-01-01&to=2026-03-31`
  );
  expect(result.status, result.text).toBe(200);
  return result.body.boxes;
}

describe("Purchase VAT audit", () => {
  it("retains line-level reverse charge when only withholding changes", async () => {
    const t = await registeredTenant();
    const b = await bill(t, { line_items: [domestic, reverseCharge] });
    expect(b.total_amount).toBe("2050.00");
    const edited = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
    expect(edited.status, edited.text).toBe(200);
    const vat = await boxes(t, b.id);
    expect({
      supplierPayable: edited.body.total_amount,
      reverseChargeOutputVat: vat.box3ReverseChargeVat,
      domesticInputVat: vat.box9ExpensesVat,
      reverseChargeInputVat: vat.box10ReverseChargeVat,
    }).toEqual({
      supplierPayable: "2040.00",
      reverseChargeOutputVat: 50,
      domesticInputVat: 50,
      reverseChargeInputVat: 50,
    });
  });

  it("uses the customs declaration after successive edits that omit import VAT", async () => {
    const t = await registeredTenant();
    const b = await bill(t, { is_import: true, import_vat_amount: 60 });
    expect(b.vat_amount).toBe("60.00");
    const first = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 10 });
    const second = await t.as.patch(`/api/bills/${b.id}`, { withholding_amount: 20 });
    expect(first.status, first.text).toBe(200);
    expect(second.status, second.text).toBe(200);
    const vat = await boxes(t, b.id);
    expect({
      declaration: first.body.import_vat_amount,
      postedVat: second.body.vat_amount,
      box6: vat.box6ImportsVat,
      box10: vat.box10ReverseChargeVat,
    }).toEqual({ declaration: "60.00", postedVat: "60.00", box6: 60, box10: 60 });
  });

  it("assigns blocked domestic VAT and recoverable reverse-charge VAT to their own boxes", async () => {
    const t = await registeredTenant();
    const expense = await t.as.post(`/api/companies/${t.company.id}/accounts`, {
      code: "5095",
      nameEn: "Client entertainment",
      nameAr: "ضيافة العملاء",
      type: "expense",
      subType: "operating_expense",
    });
    expect(expense.status, expense.text).toBe(201);
    const b = await bill(t, {
      line_items: [{ ...domestic, account_id: expense.body.id }, reverseCharge],
    });
    const vat = await boxes(t, b.id);
    expect({
      totalRecoverable: vat.box13RecoverableTax,
      domestic: vat.box9ExpensesVat,
      reverseCharge: vat.box10ReverseChargeVat,
    }).toEqual({ totalRecoverable: 50, domestic: 0, reverseCharge: 50 });
  });
});
