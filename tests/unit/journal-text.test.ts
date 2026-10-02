import { describe, expect, it } from "vitest";
import { localizeJournalText } from "../../client/src/lib/journal-text";

const ar = (s: string) => localizeJournalText(s, "ar");

describe("localizeJournalText", () => {
  it("leaves English as it is", () => {
    expect(localizeJournalText("Sales Invoice INV-2026-00001 - Al Noor", "en")).toBe("Sales Invoice INV-2026-00001 - Al Noor");
  });
  it("translates the sentences the system writes and keeps names and numbers", () => {
    expect(ar("Sales Invoice INV-2026-00001 - Al Noor Trading")).toBe("فاتورة مبيعات INV-2026-00001 - Al Noor Trading");
    expect(ar("Payment received for Invoice INV-2026-00002 - bank")).toBe("دفعة مستلمة للفاتورة INV-2026-00002 - بنك");
    expect(ar("Refund of credit note CN-2026-00001 to Emirates Towers - RF-77")).toBe("رد الإشعار الدائن CN-2026-00001 إلى Emirates Towers - RF-77");
    expect(ar("Refund of customer credit - Overpayer Co - CR-2")).toBe("رد رصيد العميل - Overpayer Co - CR-2");
    expect(ar("Invoice INV-2026-00001 — customer credit (overpayment)")).toBe("فاتورة INV-2026-00001 — رصيد دائن للعميل (دفعة زائدة)");
  });
  it("translates stock entries", () => {
    expect(ar("Inventory adjustment - Cement")).toBe("مخزون (تسوية) - Cement");
    expect(ar("Opening inventory (stock on hand at average cost)")).toBe("مخزون افتتاحي (المخزون الفعلي بمتوسط التكلفة)");
    expect(ar("Cost of goods sold - Invoice INV-2026-00004")).toBe("تكلفة البضاعة المباعة - فاتورة INV-2026-00004");
    expect(ar("Cement (adjustment)")).toBe("Cement (تسوية)");
  });
  it("translates the inside of a reversal", () => {
    expect(ar("Reversal: Refund of customer credit - Overpayer Co")).toBe("عكس: رد رصيد العميل - Overpayer Co");
  });
  it("shows an unknown sentence unchanged and handles empty values", () => {
    expect(ar("Quarterly accrual by hand")).toBe("Quarterly accrual by hand");
    expect(ar("")).toBe("");
    expect(localizeJournalText(null, "ar")).toBe("");
  });
});

describe("notifications", () => {
  it("translates the invoice and online payment notifications", () => {
    expect(ar("Invoice created")).toBe("تم إنشاء فاتورة");
    expect(ar("Online payment received")).toBe("تم استلام دفعة إلكترونية");
    expect(ar("Invoice INV-2026-00002 for Refund Buyer — 997.50 AED")).toBe("فاتورة INV-2026-00002 للعميل Refund Buyer — 997.50 AED");
    expect(ar("997.50 AED paid online for invoice INV-2026-00002.")).toBe("تم دفع 997.50 AED إلكترونياً للفاتورة INV-2026-00002.");
    expect(ar("Invoice sent")).toBe("الفاتورة مرسلة");
  });
});

describe("purchase journals", () => {
  it("translates bill, payment, vendor credit and receipt descriptions and keeps names and numbers", () => {
    expect(ar("Vendor Bill BILL-001 - Gulf Cement")).toBe("فاتورة مشتريات BILL-001 - Gulf Cement");
    expect(ar("A/P - Gulf Cement - Bill BILL-001")).toBe("الذمم الدائنة - Gulf Cement - فاتورة مشتريات BILL-001");
    expect(ar("Input VAT - Bill BILL-001")).toBe("ضريبة المدخلات - فاتورة مشتريات BILL-001");
    expect(ar("Bill BILL-002 - Sand 50 bags (clears goods received)")).toBe("فاتورة مشتريات BILL-002 - Sand 50 bags (تسوية البضاعة المستلمة)");
    expect(ar("Payment - Bill BILL-001 - Gulf Cement")).toBe("دفعة - فاتورة مشتريات BILL-001 - Gulf Cement");
    expect(ar("Settle A/P - Bill BILL-001 - Gulf Cement")).toBe("تسوية الذمم الدائنة - فاتورة مشتريات BILL-001 - Gulf Cement");
    expect(ar("Payment to Gulf Cement - Bill BILL-001")).toBe("دفعة إلى Gulf Cement - فاتورة مشتريات BILL-001");
    expect(ar("Vendor Credit VCN-2026-0001 - Gulf Cement")).toBe("إشعار دائن مورد VCN-2026-0001 - Gulf Cement");
    expect(ar("Vendor credit VCN-1 - Return 10 bags")).toBe("إشعار دائن مورد VCN-1 - Return 10 bags");
    expect(ar("Reversal: A/P - Gulf Cement - Vendor credit VCN-1")).toBe("عكس: الذمم الدائنة - Gulf Cement - إشعار دائن مورد VCN-1");
    expect(ar("Receipt: DEWA - Utilities")).toBe("إيصال: DEWA - المرافق والخدمات");
    expect(ar("Receipt: Lunch - Meals & Entertainment")).toBe("إيصال: Lunch - الوجبات والضيافة");
  });
});
