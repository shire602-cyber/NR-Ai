/** Direct, company-pinned reads for v1: list (keyset cursor) and get-by-id. */
import type { Request, Response } from "express";
import { pool } from "../db";
import { ctx } from "./context";
import { TS_SQL, decodeCursor, pageFromRows, parseLimit } from "./cursor";
import { fail, ok } from "./response";
import {
  BILL_COLUMNS,
  CONTACT_COLUMNS,
  INVOICE_COLUMNS,
  ITEM_COLUMNS,
  JOURNAL_COLUMNS,
  UUID_RE,
  billFromRow,
  contactFromRow,
  invoiceFromRow,
  itemFromRow,
  journalFromRow,
  loadBill,
  loadContact,
  loadInvoice,
  loadItem,
  loadJournal,
  paymentFromRow,
} from "./serializers";

interface ListSpec {
  from: string;
  alias: string;
  columns: string;
  map: (row: any) => unknown;
  /** Extra WHERE fragments from validated query params; params are appended after $1. */
  filters?: (req: Request, push: (value: unknown) => string) => string[] | { error: string };
}

export async function listResource(req: Request, res: Response, spec: ListSpec): Promise<void> {
  const c = ctx(req);
  const limit = parseLimit(req.query.limit);
  if (limit === null) return void fail(req, res, 400, "VALIDATION_ERROR", "limit must be an integer from 1 to 200");
  let cursor = null;
  if (req.query.cursor !== undefined && req.query.cursor !== "") {
    cursor = decodeCursor(req.query.cursor);
    if (!cursor) return void fail(req, res, 400, "INVALID_CURSOR", "The cursor is not valid");
  }
  const params: unknown[] = [c.companyId];
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const a = spec.alias;
  const where = [`${a}.company_id = $1`];
  const extra = spec.filters ? spec.filters(req, push) : [];
  if (!Array.isArray(extra)) return void fail(req, res, 400, "VALIDATION_ERROR", extra.error);
  where.push(...extra);
  if (cursor) where.push(`(${a}.created_at, ${a}.id) < (${push(cursor.t)}::timestamp, ${push(cursor.id)}::uuid)`);
  const { rows } = await pool.query(
    `SELECT ${spec.columns} FROM ${spec.from} WHERE ${where.join(" AND ")} ORDER BY ${a}.created_at DESC, ${a}.id DESC LIMIT ${limit + 1}`,
    params
  );
  const page = pageFromRows(rows, limit);
  ok(req, res, page.rows.map(spec.map), { nextCursor: page.nextCursor, limit });
}

const oneOf = (value: unknown, allowed: readonly string[]) => (typeof value === "string" && allowed.includes(value) ? value : null);

export const readContacts = (req: Request, res: Response) =>
  listResource(req, res, {
    from: "customer_contacts c",
    alias: "c",
    columns: CONTACT_COLUMNS,
    map: contactFromRow,
    filters: (r, push) => {
      if (r.query.type === undefined) return [];
      const t = oneOf(r.query.type, ["customer", "vendor"]);
      if (!t) return { error: "type must be customer or vendor" };
      return [`c.contact_type IN (${push(t)}, 'both')`];
    },
  });

export const readItems = (req: Request, res: Response) =>
  listResource(req, res, { from: "products p", alias: "p", columns: ITEM_COLUMNS, map: itemFromRow });

export const readInvoices = (req: Request, res: Response) =>
  listResource(req, res, {
    from: "invoices i",
    alias: "i",
    columns: INVOICE_COLUMNS,
    map: invoiceFromRow,
    filters: (r, push) => {
      const out: string[] = [];
      if (r.query.status !== undefined) {
        const s = oneOf(r.query.status, ["draft", "sent", "posted", "partial", "paid", "void", "cancelled", "credited"]);
        if (!s) return { error: "status is not a known invoice status" };
        out.push(`i.status = ${push(s)}`);
      }
      if (r.query.contactId !== undefined) {
        if (typeof r.query.contactId !== "string" || !UUID_RE.test(r.query.contactId)) return { error: "contactId must be a UUID" };
        out.push(`i.contact_id = ${push(r.query.contactId)}::uuid`);
      }
      // Credit notes (and late fees) are separate documents: the default list is invoices and advance invoices; ask for the rest with ?type=.
      if (r.query.type === undefined) out.push(`i.invoice_type IN ('invoice', 'advance')`);
      else {
        const t = oneOf(r.query.type, ["invoice", "advance", "credit_note", "late_fee"]);
        if (!t) return { error: "type must be invoice, advance, credit_note or late_fee" };
        out.push(`i.invoice_type = ${push(t)}`);
      }
      return out;
    },
  });

export const readBills = (req: Request, res: Response) =>
  listResource(req, res, {
    from: "vendor_bills b",
    alias: "b",
    columns: BILL_COLUMNS,
    map: billFromRow,
    filters: (r, push) => {
      const out: string[] = [];
      if (r.query.status !== undefined) {
        const s = oneOf(r.query.status, ["pending", "approved", "partial", "paid", "overdue", "void"]);
        if (!s) return { error: "status is not a known bill status" };
        out.push(`b.status = ${push(s)}`);
      }
      if (r.query.vendorId !== undefined) {
        if (typeof r.query.vendorId !== "string" || !UUID_RE.test(r.query.vendorId)) return { error: "vendorId must be a UUID" };
        out.push(`b.vendor_id = ${push(r.query.vendorId)}::uuid`);
      }
      return out;
    },
  });

export const readJournals = (req: Request, res: Response) =>
  listResource(req, res, {
    from: "journal_entries j",
    alias: "j",
    columns: JOURNAL_COLUMNS,
    map: journalFromRow,
    filters: (r, push) => {
      if (r.query.status === undefined) return [];
      const s = oneOf(r.query.status, ["draft", "posted", "void"]);
      return s ? [`j.status = ${push(s)}`] : { error: "status must be draft, posted or void" };
    },
  });

/** Payments received (invoice_payments) and made (bill_payments) as one list. */
export async function readPayments(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const limit = parseLimit(req.query.limit);
  if (limit === null) return void fail(req, res, 400, "VALIDATION_ERROR", "limit must be an integer from 1 to 200");
  const direction = req.query.direction === undefined ? null : oneOf(req.query.direction, ["received", "made"]);
  if (req.query.direction !== undefined && !direction) return void fail(req, res, 400, "VALIDATION_ERROR", "direction must be received or made");
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) return void fail(req, res, 400, "INVALID_CURSOR", "The cursor is not valid");

  const params: unknown[] = [c.companyId];
  const where: string[] = [];
  if (direction) {
    params.push(direction);
    where.push(`x.direction = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.t, cursor.id);
    where.push(`(x.created_at, x.id) < ($${params.length - 1}::timestamp, $${params.length}::uuid)`);
  }
  const { rows } = await pool.query(
    `SELECT x.id, x.direction, x.document_id, x.amount, x.day, x.method, x.reference, ${TS_SQL("x.created_at")} AS ts FROM (
        SELECT p.id, 'received'::text AS direction, p.invoice_id AS document_id, p.amount, to_char(p.date, 'YYYY-MM-DD') AS day,
               p.method, p.reference, p.created_at
          FROM invoice_payments p WHERE p.company_id = $1
        UNION ALL
        SELECT bp.id, 'made'::text, bp.bill_id, bp.amount, to_char(bp.payment_date, 'YYYY-MM-DD'),
               bp.payment_method, bp.reference, COALESCE(bp.created_at, bp.payment_date)
          FROM bill_payments bp JOIN vendor_bills b ON b.id = bp.bill_id WHERE b.company_id = $1
     ) x ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY x.created_at DESC, x.id DESC LIMIT ${limit + 1}`,
    params
  );
  const page = pageFromRows(rows, limit);
  ok(req, res, page.rows.map(paymentFromRow), { nextCursor: page.nextCursor, limit });
}

/** Payments received against one invoice. */
export async function readInvoicePayments(req: Request, res: Response): Promise<void> {
  const c = ctx(req);
  const id = req.params.id;
  if (!UUID_RE.test(id)) return void fail(req, res, 404, "NOT_FOUND", "Invoice not found");
  const found = await pool.query(`SELECT 1 FROM invoices WHERE id = $1 AND company_id = $2`, [id, c.companyId]);
  if (!found.rows[0]) return void fail(req, res, 404, "NOT_FOUND", "Invoice not found");
  const { rows } = await pool.query(
    `SELECT p.id, 'received'::text AS direction, p.invoice_id AS document_id, p.amount, to_char(p.date, 'YYYY-MM-DD') AS day,
            p.method, p.reference, ${TS_SQL("p.created_at")} AS ts
       FROM invoice_payments p WHERE p.invoice_id = $1 AND p.company_id = $2 ORDER BY p.created_at, p.id`,
    [id, c.companyId]
  );
  ok(req, res, rows.map(paymentFromRow));
}

function getById(load: (companyId: string, id: string) => Promise<unknown | null>, label: string) {
  return async (req: Request, res: Response): Promise<void> => {
    const found = await load(ctx(req).companyId, req.params.id);
    if (!found) return void fail(req, res, 404, "NOT_FOUND", `${label} not found`);
    ok(req, res, found);
  };
}
export const getContact = getById(loadContact, "Contact");
export const getItem = getById(loadItem, "Item");
export const getInvoice = getById(loadInvoice, "Invoice");
export const getBill = getById(loadBill, "Bill");
export const getJournal = getById(loadJournal, "Journal entry");
