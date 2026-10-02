/**
 * Raw rows -> v1 resources. Money is a 2 dp string, quantities and rates are
 * decimal strings, calendar days are YYYY-MM-DD, timestamps are ISO 8601 UTC.
 * Every loader is scoped by company_id, so a foreign id is simply "not found".
 */
import Decimal from "decimal.js";
import { pool } from "../db";
import { getInvoiceBalance } from "../services/invoice-outstanding.db";
import { invoiceBalanceFields } from "../services/invoice-outstanding";
import { TS_SQL } from "./cursor";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const money = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : new Decimal(String(v)).toFixed(2));
export const moneyOrZero = (v: unknown): string => money(v) ?? "0.00";
export const decimalStr = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : new Decimal(String(v)).toString());
export const isoTs = (ts: string | null | undefined): string | null => (ts ? `${ts}Z` : null);

const DAY = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;

// ───────────────────────── Contacts ─────────────────────────
export const CONTACT_COLUMNS = `c.id, c.name, c.name_ar, c.contact_type, c.email, c.phone, c.trn_number, c.address, c.city, c.emirate, c.country,
  c.contact_person, c.payment_terms, c.notes, c.is_active, ${TS_SQL("c.created_at")} AS ts`;
export function contactFromRow(r: any) {
  return {
    id: r.id,
    type: r.contact_type ?? "customer",
    name: r.name,
    nameAr: r.name_ar ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    trn: r.trn_number ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    emirate: r.emirate ?? null,
    country: r.country ?? null,
    contactPerson: r.contact_person ?? null,
    paymentTermsDays: r.payment_terms ?? null,
    notes: r.notes ?? null,
    isActive: r.is_active !== false,
    createdAt: isoTs(r.ts),
  };
}
export async function loadContact(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(`SELECT ${CONTACT_COLUMNS} FROM customer_contacts c WHERE c.company_id = $1 AND c.id = $2`, [companyId, id]);
  return rows[0] ? contactFromRow(rows[0]) : null;
}

// ───────────────────────── Accounts ─────────────────────────
export const ACCOUNT_COLUMNS = `a.id, a.code, a.name_en, a.name_ar, a.type, a.sub_type, a.is_system_account, a.is_active, a.is_archived, ${TS_SQL("a.created_at")} AS ts`;
export function accountFromRow(r: any) {
  return {
    id: r.id,
    code: r.code,
    name: r.name_en,
    nameAr: r.name_ar ?? null,
    type: r.type,
    subType: r.sub_type ?? null,
    isSystem: r.is_system_account === true,
    isActive: r.is_active !== false && r.is_archived !== true,
    createdAt: isoTs(r.ts),
  };
}
export async function loadAccount(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM accounts a WHERE a.company_id = $1 AND a.id = $2`, [companyId, id]);
  return rows[0] ? accountFromRow(rows[0]) : null;
}

// ───────────────────────── Items ─────────────────────────
export const ITEM_COLUMNS = `p.id, p.name, p.name_ar, p.sku, p.description, p.unit_price, p.cost_price, p.vat_rate, p.unit, p.track_inventory,
  p.current_stock, p.low_stock_threshold, p.is_active, ${TS_SQL("p.created_at")} AS ts`;
export function itemFromRow(r: any) {
  return {
    id: r.id,
    name: r.name,
    nameAr: r.name_ar ?? null,
    sku: r.sku ?? null,
    description: r.description ?? null,
    unitPrice: moneyOrZero(r.unit_price),
    costPrice: money(r.cost_price),
    vatRate: decimalStr(r.vat_rate) ?? "0.05",
    unit: r.unit,
    trackInventory: r.track_inventory === true,
    currentStock: Number(r.current_stock ?? 0),
    lowStockThreshold: r.low_stock_threshold ?? null,
    isActive: r.is_active !== false,
    createdAt: isoTs(r.ts),
  };
}
export async function loadItem(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(`SELECT ${ITEM_COLUMNS} FROM products p WHERE p.company_id = $1 AND p.id = $2`, [companyId, id]);
  return rows[0] ? itemFromRow(rows[0]) : null;
}

// ───────────────────────── Invoices ─────────────────────────
export const INVOICE_COLUMNS = `i.id, i.number, i.status, i.invoice_type, i.contact_id, i.customer_name, i.customer_trn, i.emirate,
  ${DAY("i.date")} AS day, ${DAY("i.due_date")} AS due_day, i.currency, i.exchange_rate, i.subtotal, i.vat_amount, i.total,
  ${TS_SQL("i.created_at")} AS ts`;
export function invoiceFromRow(r: any) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    type: r.invoice_type ?? "invoice",
    contactId: r.contact_id ?? null,
    customerName: r.customer_name,
    customerTrn: r.customer_trn ?? null,
    emirate: r.emirate ?? null,
    date: r.day,
    dueDate: r.due_day ?? null,
    currency: r.currency,
    exchangeRate: decimalStr(r.exchange_rate) ?? "1",
    subtotal: moneyOrZero(r.subtotal),
    vatAmount: moneyOrZero(r.vat_amount),
    total: moneyOrZero(r.total),
    createdAt: isoTs(r.ts),
  };
}
export async function loadInvoice(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(`SELECT ${INVOICE_COLUMNS} FROM invoices i WHERE i.company_id = $1 AND i.id = $2`, [companyId, id]);
  if (!rows[0]) return null;
  const lines = (
    await pool.query(
      `SELECT id, description, quantity, unit_price, vat_rate, vat_supply_type, product_id, revenue_account_id
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY ctid`,
      [id]
    )
  ).rows;
  const balance = await getInvoiceBalance(companyId, id).catch(() => null);
  const base = invoiceFromRow(rows[0]);
  const fields = balance ? invoiceBalanceFields({ status: base.status, invoiceType: base.type }, balance) : null;
  return {
    ...base,
    ...(fields && base.type !== "credit_note"
      ? { amountPaid: moneyOrZero(fields.paidAmount), outstanding: moneyOrZero(fields.outstandingAmount) }
      : {}),
    lines: lines.map((l: any) => ({
      id: l.id,
      description: l.description,
      quantity: decimalStr(l.quantity) ?? "0",
      unitPrice: moneyOrZero(l.unit_price),
      vatRate: decimalStr(l.vat_rate) ?? "0",
      vatSupplyType: l.vat_supply_type ?? null,
      productId: l.product_id ?? null,
      revenueAccountId: l.revenue_account_id ?? null,
    })),
  };
}

// ───────────────────────── Bills ─────────────────────────
export const BILL_COLUMNS = `b.id, b.bill_number, b.vendor_id, b.vendor_name, b.vendor_trn, ${DAY("b.bill_date")} AS day, ${DAY("b.due_date")} AS due_day,
  b.currency, b.subtotal, b.vat_amount, b.total_amount, b.amount_paid, b.status, b.category, b.notes, ${TS_SQL("b.created_at")} AS ts`;
export function billFromRow(r: any) {
  return {
    id: r.id,
    number: r.bill_number ?? null,
    vendorId: r.vendor_id ?? null,
    vendorName: r.vendor_name,
    vendorTrn: r.vendor_trn ?? null,
    date: r.day,
    dueDate: r.due_day ?? null,
    currency: r.currency ?? "AED",
    subtotal: moneyOrZero(r.subtotal),
    vatAmount: moneyOrZero(r.vat_amount),
    total: moneyOrZero(r.total_amount),
    amountPaid: moneyOrZero(r.amount_paid),
    status: r.status,
    category: r.category ?? null,
    notes: r.notes ?? null,
    createdAt: isoTs(r.ts),
  };
}
export async function loadBill(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(`SELECT ${BILL_COLUMNS} FROM vendor_bills b WHERE b.company_id = $1 AND b.id = $2`, [companyId, id]);
  if (!rows[0]) return null;
  const lines = (
    await pool.query(`SELECT id, description, quantity, unit_price, vat_rate, amount, account_id FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at, id`, [id])
  ).rows;
  return {
    ...billFromRow(rows[0]),
    lines: lines.map((l: any) => ({
      id: l.id,
      description: l.description,
      quantity: decimalStr(l.quantity) ?? "0",
      unitPrice: moneyOrZero(l.unit_price),
      vatRate: decimalStr(l.vat_rate) ?? "0",
      amount: moneyOrZero(l.amount),
      accountId: l.account_id ?? null,
    })),
  };
}

// ───────────────────────── Payments ─────────────────────────
export function paymentFromRow(r: any) {
  return {
    id: r.id,
    direction: r.direction,
    documentId: r.document_id,
    amount: moneyOrZero(r.amount),
    date: r.day,
    method: r.method ?? null,
    reference: r.reference ?? null,
    createdAt: isoTs(r.ts),
  };
}

// ───────────────────────── Journals ─────────────────────────
export const JOURNAL_COLUMNS = `j.id, j.entry_number, ${DAY("j.date")} AS day, j.memo, j.status, j.source, ${TS_SQL("j.created_at")} AS ts`;
export function journalFromRow(r: any) {
  return {
    id: r.id,
    entryNumber: r.entry_number,
    date: r.day,
    memo: r.memo ?? null,
    status: r.status,
    source: r.source,
    createdAt: isoTs(r.ts),
  };
}
export async function loadJournal(companyId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(`SELECT ${JOURNAL_COLUMNS} FROM journal_entries j WHERE j.company_id = $1 AND j.id = $2`, [companyId, id]);
  if (!rows[0]) return null;
  const lines = (
    await pool.query(
      `SELECT l.id, l.account_id, a.code, a.name_en AS name, l.debit, l.credit, l.description
         FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.entry_id = $1 ORDER BY l.ctid`,
      [id]
    )
  ).rows;
  return {
    ...journalFromRow(rows[0]),
    lines: lines.map((l: any) => ({
      id: l.id,
      accountId: l.account_id,
      accountCode: l.code ?? null,
      accountName: l.name ?? null,
      debit: moneyOrZero(l.debit),
      credit: moneyOrZero(l.credit),
      description: l.description ?? null,
    })),
  };
}
