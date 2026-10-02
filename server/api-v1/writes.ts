/**
 * v1 writes and reports: translate the validated v1 body to what the internal
 * route expects, dispatch, and turn the internal answer into a v1 resource.
 * Nothing here posts money; the internal handlers do, with every lock they have.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { ctx } from "./context";
import { dispatchTo } from "./dispatch";
import { fail } from "./response";
import { loadBill, loadContact, loadInvoice, loadItem, loadJournal, money, moneyOrZero, isoTs } from "./serializers";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

const ymd = (v: unknown): string | null => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
const rowId = (body: any): string => String(body?.id ?? body?.invoice?.id ?? "");
const dropUndefined = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

async function contactInCompany(companyId: string, id: string) {
  const { rows } = await pool.query(`SELECT id, name, trn_number, address FROM customer_contacts WHERE id = $1 AND company_id = $2`, [id, companyId]);
  return rows[0] as { id: string; name: string; trn_number: string | null; address: string | null } | undefined;
}

const referenceMissing = (req: Request, res: Response, field: string) =>
  fail(req, res, 422, "REFERENCE_NOT_FOUND", `${field} does not exist in this company`, { field });

// ───────────────────────── Contacts ─────────────────────────
function contactBody(b: any) {
  return dropUndefined({
    name: b.name,
    contactType: b.type,
    nameAr: b.nameAr,
    email: b.email,
    phone: b.phone,
    trnNumber: b.trn,
    address: b.address,
    city: b.city,
    country: b.country,
    contactPerson: b.contactPerson,
    paymentTerms: b.paymentTermsDays,
    notes: b.notes,
    isActive: b.isActive,
  });
}
export const createContact: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "POST", url: `/api/companies/${ctx(req).companyId}/customer-contacts`, body: contactBody(req.body) }, {
    map: (_s, body) => loadContact(ctx(req).companyId, rowId(body)),
    created: (d) => (d?.id ? `/api/v1/contacts/${d.id}` : undefined),
  });
export const updateContact: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "PUT", url: `/api/companies/${ctx(req).companyId}/customer-contacts/${req.params.id}`, body: contactBody(req.body) }, {
    map: () => loadContact(ctx(req).companyId, req.params.id),
  });

// ───────────────────────── Items ─────────────────────────
function itemBody(b: any) {
  const text = (v: unknown) => (v === undefined ? undefined : v === null ? null : String(v));
  return dropUndefined({
    name: b.name,
    nameAr: b.nameAr,
    sku: b.sku,
    description: b.description,
    unitPrice: text(b.unitPrice),
    costPrice: text(b.costPrice),
    vatRate: text(b.vatRate),
    unit: b.unit,
    trackInventory: b.trackInventory,
    lowStockThreshold: b.lowStockThreshold,
    isActive: b.isActive,
  });
}
export const createItem: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "POST", url: `/api/companies/${ctx(req).companyId}/products`, body: itemBody(req.body) }, {
    map: (_s, body) => loadItem(ctx(req).companyId, rowId(body)),
    created: (d) => (d?.id ? `/api/v1/items/${d.id}` : undefined),
  });
export const updateItem: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "PATCH", url: `/api/products/${req.params.id}`, body: itemBody(req.body) }, {
    map: () => loadItem(ctx(req).companyId, req.params.id),
  });

// ───────────────────────── Invoices ─────────────────────────
export const createInvoice: Handler = async (req, res, next) => {
  const c = ctx(req);
  const b = req.body;
  let customerName: string | undefined = b.customerName;
  let customerTrn = b.customerTrn;
  let customerAddress = b.customerAddress;
  if (b.contactId) {
    const contact = await contactInCompany(c.companyId, b.contactId);
    if (!contact) return void referenceMissing(req, res, "contactId");
    customerName = customerName ?? contact.name;
    customerTrn = customerTrn === undefined ? (contact.trn_number ?? undefined) : customerTrn;
    customerAddress = customerAddress === undefined ? (contact.address ?? undefined) : customerAddress;
  }
  if (!customerName) return void fail(req, res, 400, "VALIDATION_ERROR", "Send customerName or a contactId", { field: "customerName" });
  const body = dropUndefined({
    customerName,
    customerTrn,
    customerAddress,
    contactId: b.contactId ?? undefined,
    date: b.date,
    dueDate: b.dueDate,
    paymentTerms: b.paymentTerms,
    currency: b.currency,
    exchangeRate: b.exchangeRate,
    reverseCharge: b.reverseCharge,
    lines: b.lines.map((l: any) =>
      dropUndefined({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        vatSupplyType: l.vatSupplyType,
        productId: l.productId,
        revenueAccountId: l.revenueAccountId,
      })
    ),
  });
  dispatchTo(req, res, next, { method: "POST", url: `/api/companies/${c.companyId}/invoices`, body }, {
    map: (_s, internal) => loadInvoice(c.companyId, rowId(internal)),
    created: (d) => (d?.id ? `/api/v1/invoices/${d.id}` : undefined),
  });
};

/** Issue the draft: the status change to "sent" is what posts revenue and VAT. */
export const postInvoice: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "PATCH", url: `/api/invoices/${req.params.id}/status`, body: { status: "sent" } }, {
    map: () => loadInvoice(ctx(req).companyId, req.params.id),
  });

export const createInvoicePayment: Handler = async (req, res, next) => {
  const c = ctx(req);
  const b = req.body;
  const id = req.params.id;
  dispatchTo(
    req,
    res,
    next,
    {
      method: "POST",
      url: `/api/companies/${c.companyId}/invoices/${id}/payments`,
      body: dropUndefined({
        amount: b.amount,
        date: b.date,
        method: b.method,
        reference: b.reference,
        notes: b.notes,
        paymentAccountId: b.paymentAccountId,
        exchangeRate: b.exchangeRate,
      }),
    },
    {
      map: (_s, internal) => ({
        id: internal.payment?.id,
        direction: "received",
        documentId: id,
        amount: moneyOrZero(internal.payment?.amount),
        date: ymd(internal.payment?.date),
        method: internal.payment?.method ?? null,
        reference: internal.payment?.reference ?? null,
        createdAt: internal.payment?.createdAt ? new Date(internal.payment.createdAt).toISOString() : isoTs(null),
        invoiceStatus: internal.status,
        invoiceAmountPaid: money(internal.totalPaid),
      }),
      created: () => `/api/v1/invoices/${id}/payments`,
    }
  );
};

// ───────────────────────── Bills ─────────────────────────
export const createBill: Handler = async (req, res, next) => {
  const c = ctx(req);
  const b = req.body;
  if (b.vendorId) {
    const vendor = await contactInCompany(c.companyId, b.vendorId);
    if (!vendor) return void referenceMissing(req, res, "vendorId");
  }
  const accountIds = Array.from(new Set<string>(b.lines.map((l: any) => l.accountId).filter(Boolean)));
  if (accountIds.length) {
    const { rows } = await pool.query(`SELECT id FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`, [c.companyId, accountIds]);
    const known = new Set(rows.map((r: any) => r.id));
    const missing = accountIds.filter((id) => !known.has(id));
    if (missing.length) return void referenceMissing(req, res, "lines.accountId");
  }
  const body = dropUndefined({
    vendor_id: b.vendorId ?? undefined,
    vendor_name: b.vendorName,
    vendor_trn: b.vendorTrn,
    bill_number: b.number,
    bill_date: b.date,
    due_date: b.dueDate,
    currency: b.currency,
    exchange_rate: b.exchangeRate,
    category: b.category,
    notes: b.notes,
    reverse_charge: b.reverseCharge,
    line_items: b.lines.map((l: any) =>
      dropUndefined({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        vat_rate: l.vatRate === undefined ? undefined : l.vatRate === 0.05 ? 5 : l.vatRate,
        account_id: l.accountId,
      })
    ),
  });
  dispatchTo(req, res, next, { method: "POST", url: `/api/companies/${c.companyId}/bills`, body }, {
    map: (_s, internal) => loadBill(c.companyId, rowId(internal)),
    created: (d) => (d?.id ? `/api/v1/bills/${d.id}` : undefined),
  });
};

export const approveBill: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "POST", url: `/api/bills/${req.params.id}/approve`, body: {} }, {
    map: () => loadBill(ctx(req).companyId, req.params.id),
  });

export const createBillPayment: Handler = async (req, res, next) => {
  const b = req.body;
  const id = req.params.id;
  dispatchTo(
    req,
    res,
    next,
    {
      method: "POST",
      url: `/api/bills/${id}/payments`,
      body: dropUndefined({
        payment_date: b.date,
        amount: b.amount,
        payment_method: b.method,
        reference: b.reference,
        notes: b.notes,
      }),
    },
    {
      map: (_s, internal) => ({
        id: internal.payment?.id,
        direction: "made",
        documentId: id,
        amount: moneyOrZero(internal.payment?.amount),
        date: ymd(internal.payment?.payment_date),
        method: internal.payment?.payment_method ?? null,
        reference: internal.payment?.reference ?? null,
        createdAt: internal.payment?.created_at ? new Date(internal.payment.created_at).toISOString() : null,
        billStatus: internal.bill_status,
        billAmountPaid: money(internal.amount_paid),
      }),
      created: () => "/api/v1/payments?direction=made",
    }
  );
};

// ───────────────────────── Journals ─────────────────────────
export const createJournal: Handler = async (req, res, next) => {
  const c = ctx(req);
  const b = req.body;
  const body = dropUndefined({
    date: b.date,
    memo: b.memo,
    confirmBackdated: b.confirmBackdated,
    lines: b.lines.map((l: any) =>
      dropUndefined({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, description: l.description, costCenterId: l.costCenterId })
    ),
  });
  dispatchTo(req, res, next, { method: "POST", url: `/api/companies/${c.companyId}/journal`, body }, {
    map: (_s, internal) => loadJournal(c.companyId, rowId(internal)),
    created: (d) => (d?.id ? `/api/v1/journals/${d.id}` : undefined),
  });
};

export const postJournal: Handler = async (req, res, next) =>
  dispatchTo(req, res, next, { method: "POST", url: `/api/journal/${req.params.id}/post`, body: {} }, {
    map: () => loadJournal(ctx(req).companyId, req.params.id),
  });

// ───────────────────────── Reports ─────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dateParam(req: Request, name: string): string | undefined | "invalid" {
  const v = req.query[name];
  if (v === undefined || v === "") return undefined;
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : "invalid";
}

function report(build: (companyId: string, q: { from?: string; to?: string; asOf?: string }) => string, opts: { range?: boolean; asOf?: boolean; map?: (body: any) => unknown }): Handler {
  return async (req, res, next) => {
    const q: { from?: string; to?: string; asOf?: string } = {};
    for (const name of [...(opts.range ? ["from", "to"] : []), ...(opts.asOf ? ["asOf"] : [])] as const) {
      const v = dateParam(req, name);
      if (v === "invalid") return void fail(req, res, 400, "VALIDATION_ERROR", `${name} must be a YYYY-MM-DD date`, { field: name });
      if (v) (q as any)[name] = v;
    }
    dispatchTo(req, res, next, { method: "GET", url: build(ctx(req).companyId, q) }, { map: opts.map ? (_s, body) => opts.map!(body) : undefined });
  };
}
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return p ? `?${p}` : "";
};

export const trialBalance = report((cid, q) => `/api/companies/${cid}/reports/trial-balance${qs({ from: q.from, to: q.to })}`, { range: true });
export const profitAndLoss = report((cid, q) => `/api/companies/${cid}/reports/pl${qs({ startDate: q.from, endDate: q.to })}`, { range: true });
export const balanceSheet = report((cid, q) => `/api/companies/${cid}/reports/balance-sheet${qs({ endDate: q.asOf })}`, { asOf: true });
export const agedReceivables = report((cid, q) => `/api/reports/${cid}/aging${qs({ asOf: q.asOf })}`, {
  asOf: true,
  map: (rows) => (Array.isArray(rows) ? rows.filter((r) => r.type === "receivable") : rows),
});
export const agedPayables = report((cid, q) => `/api/reports/${cid}/aging${qs({ asOf: q.asOf })}`, {
  asOf: true,
  map: (rows) => (Array.isArray(rows) ? rows.filter((r) => r.type === "payable") : rows),
});
