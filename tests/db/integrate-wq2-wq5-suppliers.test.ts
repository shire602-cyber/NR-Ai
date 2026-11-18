/**
 * INTEGRATE-I (WQ2 x WQ5): a supplier contact (WQ5 unified contacts) is the vendors row that the
 * WQ2 bill supplier picker lists, and WQ2's self-TRN guard still holds when the bill names that
 * supplier only by vendor_id (the TRN comes from the vendor master, not the request body).
 */
import { describe, expect, it } from "vitest";
import { filterSuppliers, type SupplierOption } from "../../client/src/lib/purchase-pickers";
import { HARNESS_DEFAULT_TRN, useHarness } from "./harness";

const h = useHarness();

describe("INTEGRATE-I: WQ5 supplier contacts in the WQ2 bill flow", () => {
  it("a supplier contact shows in the bill supplier picker (name, Arabic name, TRN) and a bill by vendor_id carries its TRN", async () => {
    const t = await h.createTenant();
    const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Oasis Cleaning LLC",
      nameAr: "واحة للتنظيف ذ.م.م",
      isCustomer: false,
      isSupplier: true,
      partyType: "business",
      taxRegistrations: [{ type: "vat", number: "100555666700003" }],
    });
    expect(contact.status, contact.text).toBe(200);
    const vendorId = contact.body.vendorId as string;
    expect(vendorId).toBeTruthy();

    // The picker's data source (GET /vendors) and its pure filter find the contact's vendor.
    const list = await t.as.get(`/api/companies/${t.company.id}/vendors`);
    expect(list.status, list.text).toBe(200);
    const suppliers = list.body as SupplierOption[];
    for (const q of ["oasis", "واحة", "5556667"]) {
      expect(filterSuppliers(suppliers, q).map((s) => s.id)).toEqual([vendorId]);
    }
    expect(suppliers.find((s) => s.id === vendorId)?.isActive).not.toBe(false);

    // A bill that sends the picked vendor (no TRN in the body, as the picker may) gets the
    // vendor master's TRN.
    const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_id: vendorId,
      vendor_name: "Oasis Cleaning LLC",
      bill_number: "OC-1",
      bill_date: "2026-03-10",
      line_items: [{ description: "Office cleaning", quantity: 1, unit_price: 400, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    expect(bill.body).toMatchObject({
      vendor_id: vendorId,
      vendor_name: "Oasis Cleaning LLC",
      vendor_trn: "100555666700003",
    });
  });

  it("the self-TRN guard refuses a bill whose supplier contact carries the company's own TRN, even with no vendor_trn in the body", async () => {
    const t = await h.createTenant();
    const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Ourselves Mistyped LLC",
      isCustomer: false,
      isSupplier: true,
      partyType: "business",
      taxRegistrations: [{ type: "vat", number: HARNESS_DEFAULT_TRN }],
    });
    expect(contact.status, contact.text).toBe(200);
    const vendorId = contact.body.vendorId as string;
    const [v] = await h.sql<{ trn: string }>(`SELECT trn FROM vendors WHERE id = $1`, [vendorId]);
    expect(v.trn).toBe(HARNESS_DEFAULT_TRN);

    const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_id: vendorId,
      vendor_name: "Ourselves Mistyped LLC",
      bill_number: "SELF-1",
      bill_date: "2026-03-10",
      line_items: [{ description: "Our own invoice", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(422);
    expect(bill.body.code).toBe("SELF_TRN_BILL");
    expect(
      await h.sql(`SELECT 1 FROM vendor_bills WHERE company_id = $1`, [t.company.id])
    ).toHaveLength(0);
  });
});
