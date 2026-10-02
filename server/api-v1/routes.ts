/**
 * The v1 route table: one declaration drives the Express router, the scope
 * check, validation, tenant pinning and the OpenAPI document, so a route
 * cannot be mounted without being documented (a unit test compares the two).
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { z } from "zod/v4";

import { pool } from "../db";
import { requireFeature } from "../middleware/featureGate";
import { apiKeyAuth } from "./auth";
import { ctx } from "./context";
import { dispatchMiddleware } from "./dispatch";
import { idempotency } from "./idempotency";
import { perKeyLimiter } from "./limits";
import { installEnvelope, fail } from "./response";
import { requestLog } from "./request-log";
import { serveOpenApi } from "./openapi";
import { UUID_RE } from "./serializers";
import * as S from "./schemas";
import * as R from "./reads";
import * as W from "./writes";

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export interface V1Param {
  name: string;
  description: string;
  enum?: string[];
  format?: string;
}

export interface V1Route {
  operationId: string;
  method: "get" | "post" | "patch";
  /** Express path relative to /api/v1. */
  path: string;
  /** Required key scope; null = no key needed. */
  scope: string | null;
  tag: string;
  summary: string;
  query?: V1Param[];
  body?: z.ZodType;
  /** Schema of `data`; `list: true` wraps it in an array. */
  response?: z.ZodType;
  list?: boolean;
  successStatus: 200 | 201;
  /** A path :id must belong to the key's company in this table. */
  pin?: "invoices" | "vendor_bills" | "journal_entries" | "customer_contacts" | "products";
  handler: Handler;
}

const PAGING: V1Param[] = [
  { name: "limit", description: "Page size, 1-200 (default 50)" },
  { name: "cursor", description: "Opaque cursor from meta.nextCursor of the previous page" },
];

export const ROUTES: V1Route[] = [
  // Contacts
  { operationId: "listContacts", method: "get", path: "/contacts", scope: "read:contacts", tag: "Contacts", summary: "List contacts", query: [...PAGING, { name: "type", description: "customer or vendor (both-type contacts match each)", enum: ["customer", "vendor"] }], response: S.contactResponse, list: true, successStatus: 200, handler: R.readContacts },
  { operationId: "getContact", method: "get", path: "/contacts/:id", scope: "read:contacts", tag: "Contacts", summary: "Get a contact", response: S.contactResponse, successStatus: 200, handler: R.getContact },
  { operationId: "createContact", method: "post", path: "/contacts", scope: "write:contacts", tag: "Contacts", summary: "Create a contact", body: S.contactCreate, response: S.contactResponse, successStatus: 201, handler: W.createContact },
  { operationId: "updateContact", method: "patch", path: "/contacts/:id", scope: "write:contacts", tag: "Contacts", summary: "Update a contact", body: S.contactUpdate, response: S.contactResponse, successStatus: 200, pin: "customer_contacts", handler: W.updateContact },
  // Chart of accounts (read-only; the ids payments, journals and bills need)
  { operationId: "listAccounts", method: "get", path: "/accounts", scope: "read:accounts", tag: "Accounts", summary: "List the chart of accounts", query: [...PAGING, { name: "type", description: "asset, liability, equity, income or expense", enum: ["asset", "liability", "equity", "income", "expense"] }, { name: "code", description: "Exact account code, e.g. 1010" }, { name: "includeArchived", description: "true to include archived accounts", enum: ["true"] }], response: S.accountResponse, list: true, successStatus: 200, handler: R.readAccounts },
  { operationId: "getAccount", method: "get", path: "/accounts/:id", scope: "read:accounts", tag: "Accounts", summary: "Get an account", response: S.accountResponse, successStatus: 200, handler: R.getAccount },
  // Items
  { operationId: "listItems", method: "get", path: "/items", scope: "read:items", tag: "Items", summary: "List items (products and services)", query: PAGING, response: S.itemResponse, list: true, successStatus: 200, handler: R.readItems },
  { operationId: "getItem", method: "get", path: "/items/:id", scope: "read:items", tag: "Items", summary: "Get an item", response: S.itemResponse, successStatus: 200, handler: R.getItem },
  { operationId: "createItem", method: "post", path: "/items", scope: "write:items", tag: "Items", summary: "Create an item", body: S.itemCreate, response: S.itemResponse, successStatus: 201, handler: W.createItem },
  { operationId: "updateItem", method: "patch", path: "/items/:id", scope: "write:items", tag: "Items", summary: "Update an item", body: S.itemUpdate, response: S.itemResponse, successStatus: 200, pin: "products", handler: W.updateItem },
  // Invoices
  { operationId: "listInvoices", method: "get", path: "/invoices", scope: "read:invoices", tag: "Invoices", summary: "List invoices", query: [...PAGING, { name: "status", description: "Filter by status", enum: ["draft", "sent", "posted", "partial", "paid", "void", "cancelled", "credited"] }, { name: "contactId", description: "Filter by contact", format: "uuid" }, { name: "type", description: "Document type. Default: invoice and advance (credit notes are not mixed in)", enum: ["invoice", "advance", "credit_note", "late_fee"] }], response: S.invoiceResponse, list: true, successStatus: 200, handler: R.readInvoices },
  { operationId: "getInvoice", method: "get", path: "/invoices/:id", scope: "read:invoices", tag: "Invoices", summary: "Get an invoice with its lines and outstanding amount", response: S.invoiceResponse, successStatus: 200, handler: R.getInvoice },
  { operationId: "createInvoice", method: "post", path: "/invoices", scope: "write:invoices", tag: "Invoices", summary: "Create a draft invoice (posts nothing until issued)", body: S.invoiceCreate, response: S.invoiceResponse, successStatus: 201, handler: W.createInvoice },
  { operationId: "postInvoice", method: "post", path: "/invoices/:id/post", scope: "write:invoices", tag: "Invoices", summary: "Issue the invoice: posts revenue and output VAT", response: S.invoiceResponse, successStatus: 200, pin: "invoices", handler: W.postInvoice },
  // Payments
  { operationId: "listInvoicePayments", method: "get", path: "/invoices/:id/payments", scope: "read:payments", tag: "Payments", summary: "Payments received against an invoice", response: S.paymentResponse, list: true, successStatus: 200, handler: R.readInvoicePayments },
  { operationId: "createInvoicePayment", method: "post", path: "/invoices/:id/payments", scope: "write:payments", tag: "Payments", summary: "Record a payment received against an invoice", body: S.invoicePaymentCreate, response: S.paymentResponse, successStatus: 201, pin: "invoices", handler: W.createInvoicePayment },
  { operationId: "listPayments", method: "get", path: "/payments", scope: "read:payments", tag: "Payments", summary: "Payments received and made", query: [...PAGING, { name: "direction", description: "received (invoices) or made (bills)", enum: ["received", "made"] }], response: S.paymentResponse, list: true, successStatus: 200, handler: R.readPayments },
  // Bills
  { operationId: "listBills", method: "get", path: "/bills", scope: "read:bills", tag: "Bills", summary: "List vendor bills", query: [...PAGING, { name: "status", description: "Filter by status", enum: ["pending", "approved", "partial", "paid", "overdue", "void"] }, { name: "vendorId", description: "Filter by vendor contact", format: "uuid" }], response: S.billResponse, list: true, successStatus: 200, handler: R.readBills },
  { operationId: "getBill", method: "get", path: "/bills/:id", scope: "read:bills", tag: "Bills", summary: "Get a bill with its lines", response: S.billResponse, successStatus: 200, handler: R.getBill },
  { operationId: "createBill", method: "post", path: "/bills", scope: "write:bills", tag: "Bills", summary: "Create a bill (pending until approved)", body: S.billCreate, response: S.billResponse, successStatus: 201, handler: W.createBill },
  { operationId: "approveBill", method: "post", path: "/bills/:id/approve", scope: "write:bills", tag: "Bills", summary: "Approve a bill: posts the payable and input VAT", response: S.billResponse, successStatus: 200, pin: "vendor_bills", handler: W.approveBill },
  { operationId: "createBillPayment", method: "post", path: "/bills/:id/payments", scope: "write:payments", tag: "Payments", summary: "Record a payment made against a bill", body: S.billPaymentCreate, response: S.paymentResponse, successStatus: 201, pin: "vendor_bills", handler: W.createBillPayment },
  // Journals
  { operationId: "listJournals", method: "get", path: "/journals", scope: "read:journals", tag: "Journals", summary: "List journal entries", query: [...PAGING, { name: "status", description: "Filter by status", enum: ["draft", "posted", "void"] }], response: S.journalResponse, list: true, successStatus: 200, handler: R.readJournals },
  { operationId: "getJournal", method: "get", path: "/journals/:id", scope: "read:journals", tag: "Journals", summary: "Get a journal entry with its lines", response: S.journalResponse, successStatus: 200, handler: R.getJournal },
  { operationId: "createJournal", method: "post", path: "/journals", scope: "write:journals", tag: "Journals", summary: "Create a manual journal entry (draft)", body: S.journalCreate, response: S.journalResponse, successStatus: 201, handler: W.createJournal },
  { operationId: "postJournal", method: "post", path: "/journals/:id/post", scope: "write:journals", tag: "Journals", summary: "Post a draft journal entry", response: S.journalResponse, successStatus: 200, pin: "journal_entries", handler: W.postJournal },
  // Reports
  { operationId: "reportTrialBalance", method: "get", path: "/reports/trial-balance", scope: "read:reports", tag: "Reports", summary: "Trial balance", query: [{ name: "from", description: "YYYY-MM-DD", format: "date" }, { name: "to", description: "YYYY-MM-DD", format: "date" }], successStatus: 200, handler: W.trialBalance },
  { operationId: "reportProfitAndLoss", method: "get", path: "/reports/profit-and-loss", scope: "read:reports", tag: "Reports", summary: "Profit and loss", query: [{ name: "from", description: "YYYY-MM-DD", format: "date" }, { name: "to", description: "YYYY-MM-DD", format: "date" }], successStatus: 200, handler: W.profitAndLoss },
  { operationId: "reportBalanceSheet", method: "get", path: "/reports/balance-sheet", scope: "read:reports", tag: "Reports", summary: "Balance sheet", query: [{ name: "asOf", description: "YYYY-MM-DD", format: "date" }], successStatus: 200, handler: W.balanceSheet },
  { operationId: "reportAgedReceivables", method: "get", path: "/reports/aged-receivables", scope: "read:reports", tag: "Reports", summary: "Aged receivables by customer", query: [{ name: "asOf", description: "YYYY-MM-DD", format: "date" }], successStatus: 200, handler: W.agedReceivables },
  { operationId: "reportAgedPayables", method: "get", path: "/reports/aged-payables", scope: "read:reports", tag: "Reports", summary: "Aged payables by vendor", query: [{ name: "asOf", description: "YYYY-MM-DD", format: "date" }], successStatus: 200, handler: W.agedPayables },
];

/** Path param names a route uses, in order. */
export function pathParams(path: string): string[] {
  return Array.from(path.matchAll(/:(\w+)/g)).map((m) => m[1]);
}

export const isWrite = (r: V1Route) => r.method !== "get";

// ───────────────────────── Middleware factories ─────────────────────────
const requireScope = (scope: string | null): RequestHandler => (req, res, next) => {
  if (!scope) return next();
  if (!ctx(req).scopes.includes(scope)) {
    return void fail(req, res, 403, "SCOPE_MISSING", `This API key does not have the ${scope} scope`, { required: scope });
  }
  next();
};

/** True when any string in the body (keys included) holds a NUL byte, which Postgres cannot store. */
function hasNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (depth > 20 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => hasNul(v, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => k.includes("\u0000") || hasNul(v, depth + 1));
}

const validateBody = (schema: z.ZodType): RequestHandler => (req, res, next) => {
  if (hasNul(req.body)) {
    return void fail(req, res, 400, "VALIDATION_ERROR", "Text values cannot contain NUL (\\u0000) characters");
  }
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return void fail(req, res, 400, "VALIDATION_ERROR", "The request body is not valid", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
    });
  }
  req.body = parsed.data;
  next();
};

const pinTo = (table: NonNullable<V1Route["pin"]>): RequestHandler => async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return void fail(req, res, 404, "NOT_FOUND", "Not found");
    // `table` comes from the route table above, never from the request.
    const { rows } = await pool.query(`SELECT company_id FROM ${table} WHERE id = $1`, [id]);
    if (!rows[0] || rows[0].company_id !== ctx(req).companyId) return void fail(req, res, 404, "NOT_FOUND", "Not found");
    next();
  } catch (err) {
    next(err);
  }
};

/** The plan must include API access (Professional and above) at request time too. */
const gateApiAccess: RequestHandler = (req, res, next) => {
  req.params = { ...req.params, companyId: ctx(req).companyId };
  return requireFeature("apiAccess")(req, res, next) as unknown as void;
};

const safe = (h: Handler): RequestHandler => (req, res, next) => {
  Promise.resolve(h(req, res, next)).catch(next);
};

// ───────────────────────── Router ─────────────────────────
export function buildV1Router(): Router {
  const router = Router();
  router.use(installEnvelope);
  router.get("/openapi.json", serveOpenApi);

  router.use(requestLog, safe(apiKeyAuth), perKeyLimiter, gateApiAccess);

  for (const r of ROUTES) {
    const chain: RequestHandler[] = [requireScope(r.scope)];
    if (isWrite(r)) chain.push(safe(idempotency));
    if (r.body) chain.push(validateBody(r.body));
    if (r.pin) chain.push(pinTo(r.pin));
    chain.push(safe(r.handler));
    router[r.method](r.path, ...chain);
  }

  router.use((req, res) => void fail(req, res, 404, "NOT_FOUND", "No such API route"));
  return router;
}

export { dispatchMiddleware };

/** [method, path] pairs actually mounted on a router, for the OpenAPI-parity test. */
export function listMountedRoutes(router: Router): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of (router as any).stack ?? []) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) out.push({ method, path: layer.route.path });
  }
  return out;
}
