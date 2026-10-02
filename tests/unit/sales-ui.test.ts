/**
 * Phase 8 D1 screens: the pure rules behind them (client/src/lib/sales-api.ts).
 * Pay-now visibility, payload building, live totals (the shared math), badges, availability, advance helpers,
 * custom-field checks and the error-code map every sales screen shares.
 */
import { describe, expect, it } from "vitest";
import {
  SALES_ERROR_KEYS,
  advanceDeductionsFrom,
  advanceStatusTone,
  applicableAdvances,
  availabilityState,
  buildSalesBody,
  checkAmountState,
  deliveryStatusTone,
  documentDiscountPayload,
  fieldLabel,
  grossOfNet,
  invoiceDisplayStatus,
  uaeToday,
  invoicingStatusTone,
  isCashOrBankAccount,
  itemFormFromRow,
  itemPayload,
  lineNetAfterDiscount,
  lineTotalWithVat,
  netOfGross,
  payNowState,
  paymentReturnState,
  previewTotals,
  priceForProduct,
  quoteActions,
  quoteStatusTone,
  salesErrorKey,
  salesErrorMessage,
  salesOrderActions,
  salesOrderStatusTone,
  shippingPayload,
  splitStoredLines,
  stripeReturnState,
  suggestFieldKey,
  validateFieldValue,
  type CustomerAdvance,
} from "../../client/src/lib/sales-api";
import { messages as shared } from "../../client/src/components/sales/SalesShared.i18n";

const online = (over: Partial<{ configured: boolean; allowPartial: boolean; payable: boolean }> = {}) => ({
  configured: true,
  allowPartial: false,
  payable: true,
  ...over,
});

describe("Pay now visibility", () => {
  it("is shown only when the company can take payment, the invoice is payable and something is owed", () => {
    expect(payNowState(online(), 997.5)).toBe("available");
  });
  it("is hidden when online payment is not configured (no keys or no connected account)", () => {
    expect(payNowState(online({ configured: false }), 997.5)).toBe("hidden");
    expect(payNowState(undefined, 997.5)).toBe("hidden");
    expect(payNowState(null, 997.5)).toBe("hidden");
  });
  it("is hidden for an invoice that is not payable or has nothing outstanding", () => {
    expect(payNowState(online({ payable: false }), 997.5)).toBe("hidden");
    expect(payNowState(online(), 0)).toBe("hidden");
    expect(payNowState(online(), "0.00")).toBe("hidden");
    expect(payNowState(online(), undefined)).toBe("hidden");
  });
});

describe("amount to pay", () => {
  it("an empty amount means the full balance", () => {
    expect(checkAmountState({ amount: "", outstanding: 997.5, allowPartial: false })).toEqual({ ok: true, amount: null });
  });
  it("refuses an amount above what is due, a non-number and zero", () => {
    expect(checkAmountState({ amount: "2000", outstanding: 997.5, allowPartial: true })).toEqual({ ok: false, reason: "exceeds" });
    expect(checkAmountState({ amount: "abc", outstanding: 997.5, allowPartial: true })).toEqual({ ok: false, reason: "invalid" });
    expect(checkAmountState({ amount: "0", outstanding: 997.5, allowPartial: true })).toEqual({ ok: false, reason: "invalid" });
  });
  it("a part payment needs allowPartial", () => {
    expect(checkAmountState({ amount: "500", outstanding: 997.5, allowPartial: false })).toEqual({ ok: false, reason: "partial_not_allowed" });
    expect(checkAmountState({ amount: "500", outstanding: 997.5, allowPartial: true })).toEqual({ ok: true, amount: 500 });
    expect(checkAmountState({ amount: "997.50", outstanding: 997.5, allowPartial: false })).toEqual({ ok: true, amount: 997.5 });
  });
});

describe("return pages", () => {
  it("reads the payment result from the gateway return", () => {
    expect(paymentReturnState("?payment=success")).toBe("success");
    expect(paymentReturnState("?payment=cancelled")).toBe("cancelled");
    expect(paymentReturnState("?payment=other")).toBeNull();
    expect(paymentReturnState("")).toBeNull();
  });
  it("reads the Stripe connect result and its reason", () => {
    expect(stripeReturnState("?stripe=connected")).toEqual({ state: "connected", reason: null });
    expect(stripeReturnState("?stripe=error&reason=access_denied")).toEqual({ state: "error", reason: "access_denied" });
    expect(stripeReturnState("?stripe=maybe")).toBeNull();
  });
});

describe("quote badges and actions", () => {
  it("each status has its own tone", () => {
    expect(quoteStatusTone("draft")).toBe("neutral");
    expect(quoteStatusTone("sent")).toBe("info");
    expect(quoteStatusTone("accepted")).toBe("success");
    expect(quoteStatusTone("converted")).toBe("success");
    expect(quoteStatusTone("declined")).toBe("danger");
    expect(quoteStatusTone("expired")).toBe("warning");
  });
  it("a draft is edited and sent; a sent, declined or expired quote is revised, never edited", () => {
    expect(quoteActions("draft")).toMatchObject({ edit: true, send: true, revise: false, remove: true });
    for (const s of ["sent", "declined", "expired"]) expect(quoteActions(s)).toMatchObject({ edit: false, send: false, revise: true });
    expect(quoteActions("sent").remove).toBe(false);
    expect(quoteActions("declined").remove).toBe(true);
    expect(quoteActions("accepted")).toMatchObject({ edit: false, revise: false, convert: true, remove: false });
    expect(quoteActions("converted")).toMatchObject({ convert: false, remove: false });
  });
});

describe("sales order badges and actions", () => {
  it("tones follow progress", () => {
    expect(salesOrderStatusTone("open")).toBe("info");
    expect(salesOrderStatusTone("closed")).toBe("success");
    expect(salesOrderStatusTone("cancelled")).toBe("danger");
    expect(invoicingStatusTone("invoiced")).toBe("success");
    expect(invoicingStatusTone("partially_invoiced")).toBe("warning");
    expect(invoicingStatusTone("not_invoiced")).toBe("neutral");
    expect(deliveryStatusTone("delivered")).toBe("success");
    expect(deliveryStatusTone("partially_delivered")).toBe("warning");
  });
  it("edit and cancel only while nothing is invoiced or delivered; invoicing continues until fully invoiced", () => {
    const fresh = { status: "open" as const, invoicingStatus: "not_invoiced" as const, deliveryStatus: "not_delivered" as const };
    expect(salesOrderActions(fresh)).toMatchObject({ edit: true, cancel: true, invoice: true, deliver: true, close: true, remove: true });
    const part = { ...fresh, invoicingStatus: "partially_invoiced" as const };
    expect(salesOrderActions(part)).toMatchObject({ edit: false, cancel: false, invoice: true, remove: false });
    const done = { ...fresh, invoicingStatus: "invoiced" as const, deliveryStatus: "delivered" as const };
    expect(salesOrderActions(done)).toMatchObject({ invoice: false, deliver: false });
    expect(salesOrderActions({ ...fresh, status: "closed" as const })).toMatchObject({ edit: false, invoice: false, deliver: false, close: false });
    expect(salesOrderActions({ ...fresh, status: "cancelled" as const }).remove).toBe(true);
  });
});

describe("availability to promise", () => {
  it("covers the quantity, or shows the shortfall", () => {
    expect(availabilityState(4, { available: 6 })).toEqual({ tone: "ok", available: 6, shortfall: 0 });
    expect(availabilityState(10, { available: 6 })).toEqual({ tone: "short", available: 6, shortfall: 4 });
  });
  it("negative availability counts as none; an untracked product has no figure", () => {
    expect(availabilityState(1, { available: -4 })).toEqual({ tone: "short", available: 0, shortfall: 1 });
    expect(availabilityState(10, undefined)).toEqual({ tone: "unknown", available: null, shortfall: 0 });
    expect(availabilityState(10, null)).toEqual({ tone: "unknown", available: null, shortfall: 0 });
  });
});

describe("line payloads", () => {
  const item = { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 };
  it("sends the discount only when it is real", () => {
    expect(itemPayload({ ...item, discountType: "percent", discountValue: 10 })).toMatchObject({ lineKind: "item", discountType: "percent", discountValue: 10 });
    expect(itemPayload({ ...item, discountType: "percent", discountValue: "" })).toMatchObject({ discountType: null, discountValue: null });
    expect(itemPayload({ ...item, discountType: "amount", discountValue: 0 })).toMatchObject({ discountType: null, discountValue: null });
    expect(itemPayload(item)).toMatchObject({ discountType: null, discountValue: null });
  });
  it("a stored supply type rides along only on 0% lines", () => {
    expect(itemPayload({ ...item, vatRate: 0, vatSupplyType: "exempt" })).toMatchObject({ vatSupplyType: "exempt" });
    expect(itemPayload({ ...item, vatSupplyType: "exempt" })).not.toHaveProperty("vatSupplyType");
  });
  it("empty ids become null; a sales order line id is kept", () => {
    expect(itemPayload({ ...item, productId: "", revenueAccountId: "", priceListId: "" })).toMatchObject({ productId: null, revenueAccountId: null, priceListId: null });
    expect(itemPayload({ ...item, salesOrderLineId: "abc" })).toMatchObject({ salesOrderLineId: "abc" });
  });
  it("shipping is one line of quantity 1, and nothing when empty", () => {
    expect(shippingPayload({ amount: 100, vatRate: 0.05 }, "Shipping")).toEqual({ lineKind: "shipping", description: "Shipping", quantity: 1, unitPrice: 100, vatRate: 0.05 });
    expect(shippingPayload({ amount: "", vatRate: 0.05 }, "Shipping")).toBeNull();
    expect(shippingPayload({ amount: 0, vatRate: 0.05 }, "Shipping")).toBeNull();
    expect(shippingPayload(null, "Shipping")).toBeNull();
  });
  it("the document discount needs a type and a value above zero", () => {
    expect(documentDiscountPayload("amount", 50)).toEqual({ discountType: "amount", discountValue: 50 });
    expect(documentDiscountPayload("amount", "")).toEqual({ discountType: null, discountValue: null });
    expect(documentDiscountPayload(null, 50)).toEqual({ discountType: null, discountValue: null });
  });
  it("buildSalesBody puts the items first and the shipping line last", () => {
    const body = buildSalesBody({ items: [item], shipping: { amount: 100, vatRate: 0.05 }, shippingDescription: "Shipping", discountType: "amount", discountValue: 50 });
    expect(body.lines.map((l) => l.lineKind)).toEqual(["item", "shipping"]);
    expect(body).toMatchObject({ discountType: "amount", discountValue: 50 });
  });
});

describe("live totals use the server's math", () => {
  const item = { description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent" as const, discountValue: 10 };
  it("D1-7: 10% line discount, 50 off the document, 100 shipping: 950 / 47.50 / 997.50", () => {
    const r = previewTotals({ items: [item], shipping: { amount: 100, vatRate: 0.05 }, discountType: "amount", discountValue: 50 });
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.totals).toMatchObject({ subtotal: 950, vatAmount: 47.5, total: 997.5, discountAmount: 150, shippingAmount: 100, itemsSubtotal: 850 });
    }
  });
  it("a deducted advance reduces the net and the VAT with it", () => {
    const r = previewTotals({
      items: [{ description: "Work", quantity: 1, unitPrice: 3000, vatRate: 0.05 }],
      advances: [{ advanceId: "a", description: "ADV-1", net: 1000, vatRate: 0.05 }],
    });
    expect(r?.ok && r.totals).toMatchObject({ subtotal: 2000, vatAmount: 100, total: 2100 });
  });
  it("reports a discount larger than its line instead of totals", () => {
    const r = previewTotals({ items: [{ ...item, discountType: "amount", discountValue: 5000 }] });
    expect(r).toMatchObject({ ok: false, code: "DISCOUNT_EXCEEDS_LINE" });
  });
  it("nothing to total yet gives null", () => {
    expect(previewTotals({ items: [] })).toBeNull();
    expect(previewTotals({ items: [{ description: "", quantity: 0, unitPrice: 0, vatRate: 0.05 }] })).toBeNull();
  });
  it("line totals apply the line discount before VAT", () => {
    expect(lineNetAfterDiscount({ quantity: 10, unitPrice: 80, discountType: "percent", discountValue: 10 })).toBe(720);
    expect(lineTotalWithVat({ quantity: 10, unitPrice: 80, vatRate: 0.05, discountType: "percent", discountValue: 10 })).toBe(756);
    expect(lineTotalWithVat({ quantity: 2, unitPrice: 50, vatRate: 0.05 })).toBe(105);
  });
  it("advance applications from the server become deductions (active applications only)", () => {
    const deductions = advanceDeductionsFrom([
      { id: "1", advanceId: "a", kind: "application", status: "active", netAmount: 500, vatAmount: 25, advanceNumber: "ADV-1" },
      { id: "2", advanceId: "b", kind: "application", status: "reversed", netAmount: 200, vatAmount: 10, advanceNumber: "ADV-2" },
      { id: "3", advanceId: "a", kind: "refund", status: "active", netAmount: 100, vatAmount: 5, advanceNumber: "ADV-1" },
    ]);
    expect(deductions).toEqual([{ advanceId: "a", description: "ADV-1", net: 500, vatRate: 0.05, applicationId: "1" }]);
  });
});

describe("stored lines load back into the editor", () => {
  it("derived lines are left out; the shipping line becomes the shipping field", () => {
    const rows = [
      { lineKind: "item" as const, description: "A", quantity: "1", unitPrice: "1000", vatRate: "0.05", discountType: "percent" as const, discountValue: "10" },
      { lineKind: "discount" as const, description: "Discount", quantity: 1, unitPrice: -100, vatRate: 0.05 },
      { lineKind: "shipping" as const, description: "Shipping", quantity: 1, unitPrice: 100, vatRate: 0.05 },
      { lineKind: "advance" as const, description: "Less advance", quantity: 1, unitPrice: -500, vatRate: 0.05 },
    ];
    const { items, shipping } = splitStoredLines(rows);
    expect(items).toHaveLength(1);
    expect(shipping?.description).toBe("Shipping");
    expect(itemFormFromRow(items[0])).toMatchObject({ quantity: 1, unitPrice: 1000, vatRate: 0.05, discountType: "percent", discountValue: 10 });
  });
  it("rows without a line kind (older documents) are items", () => {
    expect(splitStoredLines([{ description: "Old", quantity: 1, unitPrice: 10, vatRate: 0.05 }]).items).toHaveLength(1);
    expect(splitStoredLines(undefined)).toEqual({ items: [], shipping: null });
  });
});

describe("price lists", () => {
  const resolution = { priceListId: "pl-1", prices: { "prod-1": 80 } };
  it("D1-8: the list price wins and the list id is kept for the line", () => {
    expect(priceForProduct("prod-1", 100, resolution)).toEqual({ unitPrice: 80, priceListId: "pl-1" });
  });
  it("a product not on the list, or no list at all, uses the product's own price", () => {
    expect(priceForProduct("prod-2", 100, resolution)).toEqual({ unitPrice: 100, priceListId: null });
    expect(priceForProduct("prod-1", "100", null)).toEqual({ unitPrice: 100, priceListId: null });
    expect(priceForProduct("prod-1", 100, { priceListId: null, prices: {} })).toEqual({ unitPrice: 100, priceListId: null });
  });
});

describe("customer advances", () => {
  const adv = (over: Partial<CustomerAdvance>): CustomerAdvance => ({
    id: "1", number: "ADV-1", kind: "advance", contactId: "c1", invoiceId: "i1", invoiceStatus: "paid", currency: "AED",
    vatRate: 0.05, netAmount: 1000, vatAmount: 50, grossAmount: 1050, status: "open", available: 1000, ...over,
  });
  it("offers only this customer's open, issued AED advances with something left", () => {
    const list = [adv({}), adv({ id: "2", contactId: "c2" }), adv({ id: "3", status: "applied" }), adv({ id: "4", available: 0 }), adv({ id: "5", invoiceStatus: "draft" }), adv({ id: "6", currency: "USD" })];
    expect(applicableAdvances(list, "c1").map((a) => a.id)).toEqual(["1"]);
    expect(applicableAdvances(list, null)).toEqual([]);
    expect(applicableAdvances(undefined, "c1")).toEqual([]);
  });
  it("converts between net and gross at the advance's VAT rate", () => {
    expect(grossOfNet(1000, 0.05)).toBe(1050);
    expect(netOfGross(1050, 0.05)).toBe(1000);
    expect(netOfGross(525, 0)).toBe(525);
  });
  it("status tones", () => {
    expect(advanceStatusTone("open")).toBe("info");
    expect(advanceStatusTone("applied")).toBe("success");
    expect(advanceStatusTone("refunded")).toBe("warning");
    expect(advanceStatusTone("void")).toBe("danger");
  });
  it("cash and bank accounts for receiving or refunding", () => {
    expect(isCashOrBankAccount({ type: "asset", nameEn: "Bank Accounts" })).toBe(true);
    expect(isCashOrBankAccount({ type: "asset", nameEn: "Petty Cash" })).toBe(true);
    expect(isCashOrBankAccount({ type: "asset", nameEn: "Accounts Receivable" })).toBe(false);
    expect(isCashOrBankAccount({ type: "income", nameEn: "Bank interest" })).toBe(false);
    expect(isCashOrBankAccount({ type: "asset", nameEn: "x", nameAr: "حساب بنكي" })).toBe(true);
    expect(isCashOrBankAccount({ type: "asset", nameEn: "x", nameAr: "الذمم المدينة" })).toBe(false);
    expect(isCashOrBankAccount({ type: "asset", nameEn: "x", nameAr: "البنك الوطني" })).toBe(true);
  });
});

describe("custom fields", () => {
  it("shows the label in the reader's language, English when there is no Arabic", () => {
    expect(fieldLabel({ labelEn: "PO Number", labelAr: "رقم أمر الشراء" }, "ar")).toBe("رقم أمر الشراء");
    expect(fieldLabel({ labelEn: "PO Number", labelAr: "رقم أمر الشراء" }, "en")).toBe("PO Number");
    expect(fieldLabel({ labelEn: "PO Number", labelAr: "" }, "ar")).toBe("PO Number");
  });
  it("checks a value against its type", () => {
    expect(validateFieldValue({ fieldType: "number", options: null }, "12.5")).toBe("ok");
    expect(validateFieldValue({ fieldType: "number", options: null }, "many")).toBe("number");
    expect(validateFieldValue({ fieldType: "date", options: null }, "2026-10-31")).toBe("ok");
    expect(validateFieldValue({ fieldType: "date", options: null }, "31/10/2026")).toBe("date");
    expect(validateFieldValue({ fieldType: "select", options: ["Low", "High"] }, "High")).toBe("ok");
    expect(validateFieldValue({ fieldType: "select", options: ["Low", "High"] }, "Urgent")).toBe("option");
    expect(validateFieldValue({ fieldType: "text", options: null }, "")).toBe("ok");
    expect(validateFieldValue({ fieldType: "number", options: null }, "")).toBe("ok");
  });
  it("suggests a valid key from the English label", () => {
    expect(suggestFieldKey("PO Number")).toBe("po_number");
    expect(suggestFieldKey("  Project / Code  ")).toBe("project_code");
    expect(suggestFieldKey("2nd reference")).toBe("f_2nd_reference");
    expect(suggestFieldKey("رقم")).toBe("");
    expect(suggestFieldKey("x".repeat(80)).length).toBe(40);
  });
});

describe("error codes", () => {
  it("every code the sales screens act on has a message in the shared table, English and Arabic", () => {
    const { en, ar } = shared.tables;
    for (const [code, key] of Object.entries(SALES_ERROR_KEYS)) {
      expect(en[key as keyof typeof en], `${code} -> ${key} (en)`).toBeTruthy();
      expect(ar[key as keyof typeof ar], `${code} -> ${key} (ar)`).toMatch(/[؀-ۿ]/);
    }
  });
  it("covers the business-rule codes the design lists for D1", () => {
    for (const code of [
      "DISCOUNT_EXCEEDS_LINE", "DISCOUNT_EXCEEDS_SUBTOTAL", "ADVANCE_EXCEEDED", "ADVANCE_EXCEEDS_INVOICE", "ADVANCE_CURRENCY_UNSUPPORTED",
      "ADVANCE_APPLIED_PARTIAL_CREDIT", "QUOTE_NOT_EDITABLE", "QUOTE_NOT_DRAFT", "QUOTE_NOT_OPEN", "QUOTE_ALREADY_CONVERTED", "SO_LOCKED",
      "SO_FULLY_INVOICED", "SO_QTY_EXCEEDED", "DELIVERY_EXCEEDS_ORDERED", "DISCOUNT_CONVERSION_ROUNDING", "CUSTOM_FIELD_INVALID", "DOCUMENT_LOCKED",
      "OWNER_ONLY", "PAYMENT_NOT_CONFIGURED", "INVOICE_NOT_PAYABLE", "AMOUNT_EXCEEDS_OUTSTANDING", "PARTIAL_NOT_ALLOWED", "AMOUNT_BELOW_MINIMUM",
      "CONTACT_EMAIL_REQUIRED", "INVOICE_NOT_DRAFT",
    ]) {
      expect(salesErrorKey(code), code).not.toBeNull();
    }
    expect(salesErrorKey("SOMETHING_ELSE")).toBeNull();
    expect(salesErrorKey(undefined)).toBeNull();
  });
  it("shows our wording for a known code, the server's sentence for an unknown one, and a fallback for nothing", () => {
    const tr = (k: string) => `T:${k}`;
    expect(salesErrorMessage({ code: "ADVANCE_EXCEEDED", message: "raw" }, tr, "fallback")).toBe("T:errAdvanceExceeded");
    expect(salesErrorMessage({ code: "OTHER", message: "The server says no." }, tr, "fallback")).toBe("The server says no.");
    expect(salesErrorMessage({}, tr, "fallback")).toBe("fallback");
    expect(salesErrorMessage(null, tr, "fallback")).toBe("fallback");
  });
});

describe("invoice status shown in lists", () => {
  const today = "2026-10-22";
  it("a sent or partly paid invoice past its due date reads overdue; the stored status is untouched", () => {
    const inv = { status: "sent", dueDate: "2026-10-02T00:00:00.000Z" };
    expect(invoiceDisplayStatus(inv, today)).toBe("overdue");
    expect(inv.status).toBe("sent");
    expect(invoiceDisplayStatus({ status: "partial", dueDate: "2026-10-21" }, today)).toBe("overdue");
  });
  it("due today or later is not overdue", () => {
    expect(invoiceDisplayStatus({ status: "sent", dueDate: "2026-10-22" }, today)).toBe("sent");
    expect(invoiceDisplayStatus({ status: "sent", dueDate: "2026-11-01" }, today)).toBe("sent");
  });
  it("paid, draft, void, credited, no due date and advance invoices never read overdue", () => {
    for (const status of ["paid", "draft", "void", "credited"]) expect(invoiceDisplayStatus({ status, dueDate: "2020-01-01" }, today)).toBe(status);
    expect(invoiceDisplayStatus({ status: "sent", dueDate: null }, today)).toBe("sent");
    expect(invoiceDisplayStatus({ status: "sent", dueDate: "2020-01-01", invoiceType: "advance" }, today)).toBe("sent");
    expect(invoiceDisplayStatus({ status: "sent", dueDate: "2020-01-01", invoiceType: "credit_note" }, today)).toBe("sent");
  });
  it("the UAE day, not the browser's, decides (UTC+4)", () => {
    expect(uaeToday(new Date("2026-10-21T21:00:00Z"))).toBe("2026-10-22");
    expect(uaeToday(new Date("2026-10-21T19:59:00Z"))).toBe("2026-10-21");
  });
});
