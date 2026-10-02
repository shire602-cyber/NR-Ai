/**
 * Phase 8 D1 (sales and getting paid): the shapes the sales endpoints answer with, and the small pure helpers the
 * screens share (payload building, badges, availability, Pay-now visibility). No React in here, so a unit test can
 * run it (tests/unit/sales-ui.test.ts). The server is the authority: every figure shown after a save comes from its
 * response; the live preview in the editors uses the same shared math (shared/sales-line-math.ts).
 */
import {
  deriveSalesLines,
  type AdvanceDeduction,
  type DerivedSales,
  type DiscountType,
  type SalesLineInput,
} from "@shared/sales-line-math";

export type { DiscountType };

export const SHIPPING_LINE_DESCRIPTION = "Shipping";

// ─── shapes ─────────────────────────────────────────────────────────────────

export type SalesLineKind = "item" | "discount" | "shipping" | "advance" | "late_fee";

/** A stored line of an invoice, quote or sales order as the API returns it (derived lines included). */
export interface SalesLineRow {
  id?: string;
  lineKind?: SalesLineKind | null;
  parentLineId?: string | null;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number | string;
  vatSupplyType?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
  revenueAccountId?: string | null;
  productId?: string | null;
  priceListId?: string | null;
  salesOrderLineId?: string | null;
  customerAdvanceId?: string | null;
  // sales order lines only
  invoicedQty?: number;
  deliveredQty?: number;
  remainingQty?: number;
  availableToPromise?: number | null;
  shortfall?: number | null;
}

/** The editable form of one item line. */
export interface ItemLineForm {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number;
  vatSupplyType?: string | null;
  revenueAccountId?: string | null;
  productId?: string | null;
  priceListId?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
  salesOrderLineId?: string | null;
}

export interface ShippingForm {
  amount: number | string;
  vatRate: number;
}

export interface AdvanceApplicationRow {
  id: string;
  advanceId: string;
  kind: "application" | "refund";
  status: "pending" | "active" | "reversed";
  netAmount: number;
  vatAmount: number;
  advanceNumber: string;
}

export interface CustomerAdvance {
  id: string;
  number: string;
  kind: "advance" | "deposit";
  contactId: string;
  contactName?: string;
  invoiceId: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
  salesOrderId?: string | null;
  currency: string;
  vatRate: number | string;
  netAmount: number | string;
  vatAmount: number | string;
  grossAmount: number | string;
  status: "open" | "applied" | "refunded" | "void";
  net?: number;
  applied?: number;
  refunded?: number;
  /** Net still available to apply or refund. */
  available?: number;
  createdAt?: string;
  applications?: Array<{ id: string; kind: string; status: string; invoiceId: string | null; netAmount: number | string; vatAmount: number | string }>;
}

export type CustomFieldEntity = "contact" | "invoice" | "quote" | "bill" | "sales_order";
export type CustomFieldType = "text" | "number" | "date" | "select";

export interface CustomFieldDefinition {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  labelEn: string;
  labelAr: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  showOnPdf: boolean;
  sortOrder: number;
  isArchived: boolean;
}

/** One field of one record: definition plus the stored value (GET .../custom-fields/values/:entity/:recordId). */
export interface CustomFieldValueRow {
  definitionId: string;
  key: string;
  labelEn: string;
  labelAr: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  showOnPdf: boolean;
  isArchived: boolean;
  value: string | null;
}

/** A field flagged for display, as the public pages and the portal carry it. */
export interface DisplayField {
  key: string;
  labelEn: string;
  labelAr: string;
  fieldType?: string;
  value: string;
}

export interface PriceListSummary {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
  itemCount?: number;
  items?: Array<{ id?: string; productId: string; unitPrice: number | string }>;
}

export interface PriceListResolution {
  priceListId: string | null;
  /** productId -> unit price */
  prices: Record<string, number>;
}

export interface OnlinePaymentView {
  configured: boolean;
  allowPartial: boolean;
  payable: boolean;
}

export interface GatewayStatus {
  configured: boolean;
  mode: string;
  connection: { status: string; accountId: string | null; livemode: boolean; connectedAt: string | null } | null;
  allowPartial: boolean;
  enabled: boolean;
  ready: boolean;
}

export interface ProductAvailability {
  productId: string;
  onHand: number;
  committed: number;
  available: number;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "converted" | string;
export type InvoicingStatus = "not_invoiced" | "partially_invoiced" | "invoiced";
export type DeliveryStatus = "not_delivered" | "partially_delivered" | "delivered";

export interface SalesOrderSummary {
  id: string;
  number: string;
  contactId: string;
  customerName: string;
  quoteId?: string | null;
  date: string;
  expectedDate?: string | null;
  currency: string;
  subtotal: number | string;
  vatAmount: number | string;
  total: number | string;
  status: "open" | "closed" | "cancelled";
  invoicingStatus: InvoicingStatus;
  deliveryStatus: DeliveryStatus;
}

export interface SalesOrderDetail extends SalesOrderSummary {
  notes?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
  discountAmount?: number | string;
  shippingAmount?: number | string;
  lines: SalesLineRow[];
  invoices: Array<{ id: string; number: string; status: string; total: number | string; date: string }>;
  deliveries: Array<{ id: string; number: string; date: string; notes?: string | null }>;
}

// ─── error codes -> message keys ────────────────────────────────────────────

/** Server `code` values the sales screens explain in the user's language. The key is a SalesShared message. */
export const SALES_ERROR_KEYS = {
  DISCOUNT_EXCEEDS_LINE: "errDiscountExceedsLine",
  DISCOUNT_EXCEEDS_SUBTOTAL: "errDiscountExceedsSubtotal",
  DISCOUNT_INVALID: "errDiscountInvalid",
  DISCOUNT_CONVERSION_ROUNDING: "errDiscountConversionRounding",
  SHIPPING_LINE_LIMIT: "errShippingLimit",
  ADVANCE_EXCEEDED: "errAdvanceExceeded",
  ADVANCE_EXCEEDS_INVOICE: "errAdvanceExceedsInvoice",
  ADVANCE_CURRENCY_UNSUPPORTED: "errAdvanceCurrency",
  ADVANCE_APPLIED_PARTIAL_CREDIT: "errAdvancePartialCredit",
  ADVANCE_NOT_ISSUED: "errAdvanceNotIssued",
  INVOICE_NOT_DRAFT: "errInvoiceNotDraft",
  QUOTE_NOT_EDITABLE: "errQuoteNotEditable",
  QUOTE_NOT_DRAFT: "errQuoteNotDraft",
  QUOTE_NOT_OPEN: "errQuoteNotOpen",
  QUOTE_ALREADY_CONVERTED: "errQuoteConverted",
  SO_LOCKED: "errSoLocked",
  SO_FULLY_INVOICED: "errSoFullyInvoiced",
  SO_QTY_EXCEEDED: "errSoQtyExceeded",
  SO_DISCOUNT_PERCENT_ONLY: "errSoPercentOnly",
  DELIVERY_EXCEEDS_ORDERED: "errDeliveryExceeds",
  CUSTOM_FIELD_INVALID: "errCustomFieldInvalid",
  DOCUMENT_LOCKED: "errDocumentLocked",
  OWNER_ONLY: "errOwnerOnly",
  PAYMENT_NOT_CONFIGURED: "errPaymentNotConfigured",
  INVOICE_NOT_PAYABLE: "errInvoiceNotPayable",
  AMOUNT_EXCEEDS_OUTSTANDING: "errAmountExceedsOutstanding",
  PARTIAL_NOT_ALLOWED: "errPartialNotAllowed",
  AMOUNT_BELOW_MINIMUM: "errAmountBelowMinimum",
  ALREADY_CONNECTED: "errAlreadyConnected",
  CONTACT_EMAIL_REQUIRED: "errContactEmailRequired",
} as const;

export type SalesErrorKey = (typeof SALES_ERROR_KEYS)[keyof typeof SALES_ERROR_KEYS];

export function salesErrorKey(code: string | undefined | null): SalesErrorKey | null {
  if (!code) return null;
  return (SALES_ERROR_KEYS as Record<string, SalesErrorKey>)[code] ?? null;
}

/**
 * The text to show for a failed sales call: our own wording for the codes above, the server's message otherwise
 * (it is already a readable sentence), and `fallback` when there is nothing to show.
 */
export function salesErrorMessage(error: unknown, translate: (key: SalesErrorKey) => string, fallback: string): string {
  const code = (error as { code?: string } | null)?.code;
  const key = salesErrorKey(code);
  if (key) return translate(key);
  const message = (error as { message?: string } | null)?.message;
  return message && message.trim() ? message : fallback;
}

// ─── numbers ────────────────────────────────────────────────────────────────

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── invoice status shown in lists ───

/** Today in the UAE (YYYY-MM-DD): the day an invoice becomes overdue, whatever time zone the browser is in. */
export function uaeToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The status to SHOW for an invoice: "overdue" when it is sent or partly paid and its due date is before today (UAE day).
 * Display only: the stored status never changes (it is still sent / partial).
 */
export function invoiceDisplayStatus(
  invoice: { status: string; dueDate?: string | Date | null; invoiceType?: string | null },
  today: string = uaeToday()
): string {
  if (invoice.invoiceType && invoice.invoiceType !== "invoice" && invoice.invoiceType !== "late_fee") return invoice.status;
  if ((invoice.status !== "sent" && invoice.status !== "partial") || !invoice.dueDate) return invoice.status;
  const due = typeof invoice.dueDate === "string" ? invoice.dueDate.slice(0, 10) : uaeToday(invoice.dueDate);
  return due < today ? "overdue" : invoice.status;
}

// ─── lines ──────────────────────────────────────────────────────────────────

/** The lines a person edits: items and the single shipping line. Derived lines (discount, advance, late fee) are rebuilt by the server. */
export function splitStoredLines(rows: SalesLineRow[] | undefined | null): { items: SalesLineRow[]; shipping: SalesLineRow | null } {
  const list = rows ?? [];
  const shipping = list.find((r) => r.lineKind === "shipping") ?? null;
  const items = list.filter((r) => !r.lineKind || r.lineKind === "item");
  return { items, shipping };
}

export function itemFormFromRow(row: SalesLineRow): ItemLineForm {
  return {
    description: row.description,
    quantity: toNum(row.quantity),
    unitPrice: toNum(row.unitPrice),
    vatRate: toNum(row.vatRate),
    vatSupplyType: row.vatSupplyType ?? null,
    revenueAccountId: row.revenueAccountId ?? null,
    productId: row.productId ?? null,
    priceListId: row.priceListId ?? null,
    discountType: row.discountType ?? null,
    discountValue: row.discountValue === null || row.discountValue === undefined ? null : toNum(row.discountValue),
    salesOrderLineId: row.salesOrderLineId ?? null,
  };
}

export function shippingFormFromRow(row: SalesLineRow | null): ShippingForm {
  if (!row) return { amount: "", vatRate: 0.05 };
  return { amount: round2(toNum(row.quantity) * toNum(row.unitPrice)), vatRate: toNum(row.vatRate) };
}

/** Net of one item line after its own discount (what the line contributes before VAT). */
export function lineNetAfterDiscount(line: Pick<ItemLineForm, "quantity" | "unitPrice" | "discountType" | "discountValue">): number {
  const gross = toNum(line.quantity) * toNum(line.unitPrice);
  const v = toNum(line.discountValue);
  if (!line.discountType || !(v > 0)) return round2(gross);
  const off = line.discountType === "percent" ? gross * (Math.min(v, 100) / 100) : Math.min(v, gross);
  return round2(gross - off);
}

/** The line total with VAT, discount applied: the figure at the end of an editor row. */
export function lineTotalWithVat(line: Pick<ItemLineForm, "quantity" | "unitPrice" | "vatRate" | "discountType" | "discountValue">): number {
  return round2(lineNetAfterDiscount(line) * (1 + toNum(line.vatRate)));
}

/** The wire form of an item line: a stored supply type only rides along on 0% lines (the rate decides it otherwise). */
export function itemPayload(line: ItemLineForm) {
  const discountValue = line.discountValue === "" || line.discountValue === null || line.discountValue === undefined ? null : toNum(line.discountValue);
  const hasDiscount = !!line.discountType && discountValue !== null && discountValue > 0;
  return {
    lineKind: "item" as const,
    description: line.description,
    quantity: toNum(line.quantity),
    unitPrice: toNum(line.unitPrice),
    vatRate: toNum(line.vatRate),
    revenueAccountId: line.revenueAccountId || null,
    productId: line.productId || null,
    priceListId: line.priceListId || null,
    ...(line.salesOrderLineId ? { salesOrderLineId: line.salesOrderLineId } : {}),
    discountType: hasDiscount ? line.discountType : null,
    discountValue: hasDiscount ? discountValue : null,
    ...(line.vatSupplyType && toNum(line.vatRate) === 0 ? { vatSupplyType: line.vatSupplyType } : {}),
  };
}

/** Shipping rides as one line of quantity 1; nothing is sent when the amount is empty or zero. */
export function shippingPayload(shipping: ShippingForm | null | undefined, description: string) {
  const amount = toNum(shipping?.amount);
  if (!(amount > 0)) return null;
  return { lineKind: "shipping" as const, description, quantity: 1, unitPrice: round2(amount), vatRate: toNum(shipping?.vatRate ?? 0.05) };
}

export function documentDiscountPayload(type: DiscountType | null | undefined, value: number | string | null | undefined) {
  const v = value === "" || value === null || value === undefined ? null : toNum(value);
  if (!type || v === null || !(v > 0)) return { discountType: null, discountValue: null };
  return { discountType: type, discountValue: v };
}

/** Everything the sales editors add to an invoice / quote / sales order body. */
export function buildSalesBody(args: {
  items: ItemLineForm[];
  shipping?: ShippingForm | null;
  shippingDescription: string;
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
}) {
  const lines: Array<ReturnType<typeof itemPayload> | NonNullable<ReturnType<typeof shippingPayload>>> = args.items.map(itemPayload);
  const ship = shippingPayload(args.shipping, args.shippingDescription);
  if (ship) lines.push(ship);
  return { lines, ...documentDiscountPayload(args.discountType, args.discountValue) };
}

// ─── live totals ────────────────────────────────────────────────────────────

export type PreviewResult = { ok: true; totals: DerivedSales } | { ok: false; code: string; message: string } | null;

/** The advances an invoice has deducted, shaped for the shared math (active applications only). */
export function advanceDeductionsFrom(applications: AdvanceApplicationRow[] | undefined | null): AdvanceDeduction[] {
  return (applications ?? [])
    .filter((a) => a.kind === "application" && a.status === "active" && a.netAmount > 0)
    .map((a) => ({
      advanceId: a.advanceId,
      description: a.advanceNumber,
      net: a.netAmount,
      vatRate: a.netAmount > 0 ? round2(a.vatAmount / a.netAmount) : 0,
      applicationId: a.id,
    }));
}

/** Totals as the server will compute them (same shared math). Null while there is nothing to total. */
export function previewTotals(args: {
  items: ItemLineForm[];
  shipping?: ShippingForm | null;
  discountType?: DiscountType | null;
  discountValue?: number | string | null;
  advances?: AdvanceDeduction[];
}): PreviewResult {
  const lines: SalesLineInput[] = args.items
    .filter((l) => toNum(l.quantity) > 0 && toNum(l.unitPrice) >= 0)
    .map((l) => {
      const p = itemPayload(l);
      return {
        kind: "item" as const,
        description: p.description || "-",
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        vatRate: p.vatRate,
        vatSupplyType: (p as { vatSupplyType?: string }).vatSupplyType ?? null,
        discountType: p.discountType,
        discountValue: p.discountValue,
      };
    });
  const ship = shippingPayload(args.shipping, "shipping");
  if (ship) lines.push({ kind: "shipping", description: ship.description, quantity: 1, unitPrice: ship.unitPrice, vatRate: ship.vatRate });
  if (lines.length === 0) return null;
  const d = documentDiscountPayload(args.discountType, args.discountValue);
  const result = deriveSalesLines({ lines, discountType: d.discountType, discountValue: d.discountValue, advances: args.advances });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, totals: result };
}

// ─── price lists ────────────────────────────────────────────────────────────

/** Unit price for a product: the customer's price list wins, otherwise the product's own price. */
export function priceForProduct(
  productId: string,
  productUnitPrice: number | string | null | undefined,
  resolution: PriceListResolution | null | undefined
): { unitPrice: number; priceListId: string | null } {
  const listed = resolution?.prices?.[productId];
  if (listed !== undefined && resolution?.priceListId) return { unitPrice: toNum(listed), priceListId: resolution.priceListId };
  return { unitPrice: toNum(productUnitPrice), priceListId: null };
}

// ─── Pay now (public invoice view and customer portal) ──────────────────────

export type PayNowState = "hidden" | "available";

/**
 * Pay now exists only when the company can really take payment (provider keys set AND a connected account: the
 * server folds both into `configured`), the invoice is payable and something is still owed.
 */
export function payNowState(onlinePayment: OnlinePaymentView | null | undefined, outstanding: number | string | null | undefined): PayNowState {
  if (!onlinePayment || !onlinePayment.configured || !onlinePayment.payable) return "hidden";
  return toNum(outstanding) > 0.004 ? "available" : "hidden";
}

/** The amount a customer may pay: the whole outstanding balance, or less when the company allows partial payments. */
export function checkAmountState(args: {
  amount: string;
  outstanding: number;
  allowPartial: boolean;
}): { ok: true; amount: number | null } | { ok: false; reason: "invalid" | "exceeds" | "partial_not_allowed" } {
  const raw = args.amount.trim();
  if (raw === "") return { ok: true, amount: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "invalid" };
  if (round2(n) > round2(args.outstanding) + 0.004) return { ok: false, reason: "exceeds" };
  if (round2(n) < round2(args.outstanding) - 0.004 && !args.allowPartial) return { ok: false, reason: "partial_not_allowed" };
  return { ok: true, amount: round2(n) };
}

/** Where a gateway return lands: `?payment=success|cancelled` on the page the customer came from. */
export function paymentReturnState(search: string): "success" | "cancelled" | null {
  const value = new URLSearchParams(search).get("payment");
  return value === "success" || value === "cancelled" ? value : null;
}

/** `/settings/sales?stripe=connected|error&reason=` after the Stripe Connect callback. */
export function stripeReturnState(search: string): { state: "connected" | "error"; reason: string | null } | null {
  const params = new URLSearchParams(search);
  const state = params.get("stripe");
  if (state !== "connected" && state !== "error") return null;
  return { state, reason: params.get("reason") };
}

// ─── badges ─────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function quoteStatusTone(status: string): Tone {
  switch (status) {
    case "sent":
      return "info";
    case "accepted":
    case "converted":
      return "success";
    case "declined":
      return "danger";
    case "expired":
      return "warning";
    default:
      return "neutral";
  }
}

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired", "converted"] as const;

/** A quote is editable only as a draft; a sent, declined or expired one is revised first. */
export function quoteActions(status: string): { edit: boolean; send: boolean; revise: boolean; convert: boolean; remove: boolean } {
  return {
    edit: status === "draft",
    send: status === "draft",
    revise: status === "sent" || status === "declined" || status === "expired",
    convert: status === "draft" || status === "sent" || status === "accepted",
    remove: status === "draft" || status === "declined" || status === "expired",
  };
}

export function salesOrderStatusTone(status: string): Tone {
  switch (status) {
    case "open":
      return "info";
    case "closed":
      return "success";
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export function invoicingStatusTone(status: string): Tone {
  return status === "invoiced" ? "success" : status === "partially_invoiced" ? "warning" : "neutral";
}

export function deliveryStatusTone(status: string): Tone {
  return status === "delivered" ? "success" : status === "partially_delivered" ? "warning" : "neutral";
}

export function advanceStatusTone(status: string): Tone {
  switch (status) {
    case "open":
      return "info";
    case "applied":
      return "success";
    case "refunded":
      return "warning";
    case "void":
      return "danger";
    default:
      return "neutral";
  }
}

/** Sales order actions by state: edits only while nothing is invoiced or delivered; cancel only then too. */
export function salesOrderActions(order: Pick<SalesOrderSummary, "status" | "invoicingStatus" | "deliveryStatus">) {
  const open = order.status === "open";
  const untouched = order.invoicingStatus === "not_invoiced" && order.deliveryStatus === "not_delivered";
  return {
    edit: open && untouched,
    invoice: open && order.invoicingStatus !== "invoiced",
    deliver: open && order.deliveryStatus !== "delivered",
    close: open,
    cancel: open && untouched,
    remove: order.status === "cancelled" || (open && untouched),
  };
}

// ─── availability (available to promise) ────────────────────────────────────

export type AvailabilityTone = "ok" | "short" | "unknown";

/** Does stock cover the quantity wanted? Untracked products (no figure) are "unknown", never "short". */
export function availabilityState(
  requested: number,
  availability: Pick<ProductAvailability, "available"> | null | undefined
): { tone: AvailabilityTone; available: number | null; shortfall: number } {
  if (!availability) return { tone: "unknown", available: null, shortfall: 0 };
  const available = Math.max(0, availability.available);
  const shortfall = Math.max(0, round2(requested - available));
  return { tone: shortfall > 0 ? "short" : "ok", available, shortfall };
}

// ─── advances ───────────────────────────────────────────────────────────────

/** Advances that can still be applied to an invoice of this customer (issued, open, something left). */
export function applicableAdvances(advances: CustomerAdvance[] | undefined | null, contactId: string | null | undefined): CustomerAdvance[] {
  if (!contactId) return [];
  return (advances ?? []).filter(
    (a) =>
      a.contactId === contactId &&
      a.status === "open" &&
      a.currency === "AED" &&
      toNum(a.available) > 0.004 &&
      ["sent", "posted", "partial", "paid"].includes(a.invoiceStatus ?? "")
  );
}

/** Gross (VAT included) of a net amount at the advance's VAT rate: what the customer gets back on a refund. */
export function grossOfNet(net: number, vatRate: number | string): number {
  return round2(net * (1 + toNum(vatRate)));
}

export function netOfGross(gross: number, vatRate: number | string): number {
  return round2(gross / (1 + toNum(vatRate)));
}

/** Cash and bank accounts a payment or refund can go through (same rule as the invoice payment dialog). */
export function isCashOrBankAccount(acc: { type?: string | null; nameEn?: string | null; nameAr?: string | null }): boolean {
  const en = (acc.nameEn ?? "").toLowerCase();
  const ar = (acc.nameAr ?? "").toLowerCase();
  return (
    acc.type === "asset" &&
    (en.includes("bank") || en.includes("cash") || en.includes("cheque") || ar.includes("بنك") || ar.includes("نقد") || ar.includes("شيك"))
  );
}

// ─── custom fields ──────────────────────────────────────────────────────────

/** The label in the reader's language. */
export function fieldLabel(field: { labelEn: string; labelAr: string }, locale: string): string {
  return locale === "ar" && field.labelAr ? field.labelAr : field.labelEn;
}

/** Client-side check of one field value (the server is the authority; this only spares a round trip). */
export function validateFieldValue(def: Pick<CustomFieldDefinition, "fieldType" | "options">, value: string): "ok" | "number" | "date" | "option" {
  const v = value.trim();
  if (v === "") return "ok";
  if (def.fieldType === "number") return Number.isFinite(Number(v)) ? "ok" : "number";
  if (def.fieldType === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? "ok" : "date";
  if (def.fieldType === "select") return (def.options ?? []).includes(v) ? "ok" : "option";
  return "ok";
}

/** Key from an English label: lowercase letters, digits, underscore, starting with a letter, 40 characters at most. */
export function suggestFieldKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `f_${base}`.slice(0, 40);
}

export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

// ─── stable query keys ──────────────────────────────────────────────────────

export const salesKeys = {
  advances: (companyId: string | undefined | null) => ["/api/companies", companyId, "customer-advances"] as const,
  salesOrders: (companyId: string | undefined | null) => ["/api/companies", companyId, "sales-orders"] as const,
  customFields: (companyId: string | undefined | null, entity: CustomFieldEntity | "all") => ["/api/companies", companyId, "custom-fields", entity] as const,
  customFieldValues: (companyId: string | undefined | null, entity: CustomFieldEntity, recordId: string | null | undefined) =>
    ["/api/companies", companyId, "custom-fields", "values", entity, recordId ?? "new"] as const,
  priceLists: (companyId: string | undefined | null) => ["/api/companies", companyId, "price-lists"] as const,
  gateway: (companyId: string | undefined | null) => ["/api/companies", companyId, "payment-gateway"] as const,
  availability: (companyId: string | undefined | null, ids: string) => ["/api/companies", companyId, "products", "availability", ids] as const,
};
