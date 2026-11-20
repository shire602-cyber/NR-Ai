/**
 * Public REST API, version 1 (W5-B, R19-01, R19-15).
 *
 *   /api/v1/*  — API-key authenticated (server/middleware/api-key-auth.ts),
 *               bound to the key's company, scope-checked, rate-limited per key.
 *
 * Thin wrappers over existing services: invoices and payments use the same
 * preparation / number allocation / payment service as the app; reports use
 * server/reporting. Every write validates a strict zod schema (unknown keys
 * are 400). The OpenAPI document is generated from those schemas and served
 * at /api/v1/openapi.json (copy in docs/api/openapi.json).
 */
import type { Express, Request, Response, Router } from "express";
import { parsedBody } from "../http/parsed-body";
import express from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { pq } from "../services/connectors/pq";
import {
  accounts,
  customerContacts,
  invoiceLines,
  invoicePayments,
  invoices,
  type CustomerContact,
} from "../../shared/schema";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { API_SCOPES, apiKeyAuth, requireScope, type ApiScope } from "../middleware/api-key-auth";
import {
  zCurrency,
  zDate,
  zEmirate,
  zMoneyPositive,
  zText,
  zTrn,
  zUuid,
} from "../../shared/validators/primitives";
import { salesLinesSchema, zPaymentTerms } from "../../shared/validators/invoices";
import { createDraftInvoice } from "../services/connectors/draft-documents";
import { recordInvoicePayment } from "../services/invoice-payment.service";
import { emitDomainEvent } from "../platform/domain-events";
import { trialBalance, uaeToday } from "../reporting";
import { buildOpenApiDocument, type OpenApiOperation } from "../services/connectors/openapi";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

const invoiceListQuery = listQuery
  .extend({ status: z.enum(["draft", "sent", "posted", "partial", "paid", "void"]).optional() })
  .strict();

const trialBalanceQuery = z.object({ from: zDate.optional(), to: zDate.optional() }).strict();

export const v1CreateInvoiceBody = z
  .object({
    contactId: zUuid.optional().nullable(),
    customerName: zText(300).optional(),
    customerTrn: zTrn.optional().nullable(),
    customerAddress: zText(1000).optional().nullable(),
    date: zDate,
    dueDate: zDate.optional().nullable(),
    paymentTerms: zPaymentTerms.optional().nullable(),
    currency: zCurrency.optional(),
    exchangeRate: z.number().positive().max(1_000_000).optional().nullable(),
    placeOfSupplyEmirate: zEmirate.optional().nullable(),
    notes: zText(4000).optional().nullable(),
    lines: salesLinesSchema,
  })
  .strict();

export const v1CreateContactBody = z
  .object({
    name: zText(300, { min: 1 }),
    nameAr: zText(300).optional().nullable(),
    email: z.string().trim().email().max(320).optional().nullable(),
    phone: zText(50).optional().nullable(),
    trnNumber: zTrn.optional().nullable(),
    address: zText(1000).optional().nullable(),
    city: zText(100).optional().nullable(),
    country: zText(100).optional().nullable(),
    emirate: zEmirate.optional().nullable(),
    paymentTerms: z.number().int().min(0).max(365).optional(),
  })
  .strict();

export const v1CreatePaymentBody = z
  .object({
    amount: zMoneyPositive,
    date: zDate,
    paymentAccountId: zUuid,
    method: z.enum(["bank_transfer", "cash", "card", "cheque", "other"]).optional(),
    reference: zText(200).optional().nullable(),
  })
  .strict();

// ─── Operation catalogue (drives the OpenAPI document) ──────────────────────

const OPERATIONS: OpenApiOperation[] = [
  {
    method: "get",
    path: "/invoices",
    summary: "List invoices (newest first)",
    scope: "read:invoices",
    query: invoiceListQuery,
    responseDescription: "{ data: Invoice[], limit, offset }",
  },
  {
    method: "get",
    path: "/invoices/{id}",
    summary: "Get one invoice with its lines",
    scope: "read:invoices",
    pathParams: ["id"],
    responseDescription: "Invoice with lines",
  },
  {
    method: "post",
    path: "/invoices",
    summary: "Create a draft invoice (unit prices are decimal AED)",
    scope: "write:invoices",
    body: v1CreateInvoiceBody,
    responseDescription: "The draft invoice",
  },
  {
    method: "post",
    path: "/invoices/{id}/payments",
    summary: "Record a payment against an issued invoice",
    scope: "write:payments",
    pathParams: ["id"],
    body: v1CreatePaymentBody,
    responseDescription: "The payment",
  },
  {
    method: "get",
    path: "/payments",
    summary: "List invoice payments",
    scope: "read:payments",
    query: listQuery,
    responseDescription: "{ data: Payment[], limit, offset }",
  },
  {
    method: "get",
    path: "/contacts",
    summary: "List customer contacts",
    scope: "read:contacts",
    query: listQuery,
    responseDescription: "{ data: Contact[], limit, offset }",
  },
  {
    method: "post",
    path: "/contacts",
    summary: "Create a customer contact",
    scope: "write:contacts",
    body: v1CreateContactBody,
    responseDescription: "The contact",
  },
  {
    method: "get",
    path: "/bills",
    summary: "List vendor bills",
    scope: "read:bills",
    query: listQuery,
    responseDescription: "{ data: Bill[], limit, offset }",
  },
  {
    method: "get",
    path: "/accounts",
    summary: "Chart of accounts",
    scope: "read:accounts",
    responseDescription: "{ data: Account[] }",
  },
  {
    method: "get",
    path: "/reports/trial-balance",
    summary: "Trial balance (server/reporting) for an optional date range",
    scope: "read:reports",
    query: trialBalanceQuery,
    responseDescription: "TrialBalance",
  },
];

export function publicApiOpenApiDocument() {
  return buildOpenApiDocument(OPERATIONS, API_SCOPES);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function companyOf(req: Request): string {
  return req.apiKey!.companyId;
}

function parseQuery<S extends z.ZodTypeAny>(schema: S, req: Request): z.output<S> {
  return schema.parse(req.query ?? {});
}

function page(q: { limit?: number; offset?: number }) {
  return { limit: q.limit ?? 50, offset: q.offset ?? 0 };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): never {
  throw new DomainError("NOT_FOUND", 404, undefined, "Not found");
}

/** The user an API write is attributed to (the key's creator). */
async function keyActor(req: Request): Promise<string> {
  const { rows } = await pq<{ created_by: string | null }>(
    `SELECT created_by FROM api_keys WHERE id = $1`,
    [req.apiKey!.id]
  );
  const actor = rows[0]?.created_by;
  if (!actor) {
    throw new DomainError(
      "API_KEY_HAS_NO_OWNER",
      409,
      undefined,
      "This API key has no owning user; create a new key to perform writes."
    );
  }
  return actor;
}

function scoped(scope: ApiScope) {
  return requireScope(scope);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerPublicApiRoutes(app: Express) {
  const router: Router = express.Router();

  // The OpenAPI document is public (no key needed to read the contract).
  router.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(publicApiOpenApiDocument());
  });

  router.use(apiKeyAuth);

  router.get(
    "/invoices",
    scoped("read:invoices"),
    asyncHandler(async (req: Request, res: Response) => {
      const q = parseQuery(invoiceListQuery, req);
      const { limit, offset } = page(q);
      const where = q.status
        ? and(eq(invoices.companyId, companyOf(req)), eq(invoices.status, q.status))
        : eq(invoices.companyId, companyOf(req));
      const data = await db
        .select()
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.date), desc(invoices.createdAt))
        .limit(limit)
        .offset(offset);
      res.json({ data: data.map(publicInvoice), limit, offset });
    })
  );

  router.get(
    "/invoices/:id",
    scoped("read:invoices"),
    asyncHandler(async (req: Request, res: Response) => {
      if (!UUID_RE.test(req.params.id)) notFound();
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, req.params.id), eq(invoices.companyId, companyOf(req))));
      if (!inv) notFound();
      const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
      res.json({ ...publicInvoice(inv), lines });
    })
  );

  router.post(
    "/invoices",
    scoped("write:invoices"),
    strictBody(v1CreateInvoiceBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof v1CreateInvoiceBody>>(req);
      const actor = await keyActor(req);
      const invoice = await createDraftInvoice(
        companyOf(req),
        {
          ...body,
          // WQ1 (13.5): the invoice list's "Source: API" filter.
          source: "api",
          lines: body.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            vatSupplyType: l.vatSupplyType ?? null,
            discountType: l.discountType ?? null,
            discountValue: l.discountValue ?? null,
            productId: l.productId ?? null,
            costCenterId: l.costCenterId ?? null,
          })),
        },
        actor
      );
      res.status(201).json(publicInvoice(invoice));
    })
  );

  router.post(
    "/invoices/:id/payments",
    scoped("write:payments"),
    strictBody(v1CreatePaymentBody),
    asyncHandler(async (req: Request, res: Response) => {
      if (!UUID_RE.test(req.params.id)) notFound();
      const body = parsedBody<z.output<typeof v1CreatePaymentBody>>(req);
      const companyId = companyOf(req);
      const [inv] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, req.params.id), eq(invoices.companyId, companyId)));
      if (!inv) notFound();
      const actor = await keyActor(req);
      const result = await recordInvoicePayment({
        invoiceId: inv.id,
        companyId,
        amount: Number(body.amount),
        date: new Date(`${body.date}T00:00:00.000Z`),
        method: body.method ?? "bank_transfer",
        reference: body.reference ?? null,
        paymentAccountId: body.paymentAccountId,
        createdBy: actor,
      });
      res.status(201).json(result);
    })
  );

  router.get(
    "/payments",
    scoped("read:payments"),
    asyncHandler(async (req: Request, res: Response) => {
      const { limit, offset } = page(parseQuery(listQuery, req));
      const companyInvoices = db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.companyId, companyOf(req)));
      const data = await db
        .select()
        .from(invoicePayments)
        .where(inArray(invoicePayments.invoiceId, companyInvoices))
        .orderBy(desc(invoicePayments.createdAt))
        .limit(limit)
        .offset(offset);
      res.json({ data, limit, offset });
    })
  );

  router.get(
    "/contacts",
    scoped("read:contacts"),
    asyncHandler(async (req: Request, res: Response) => {
      const { limit, offset } = page(parseQuery(listQuery, req));
      const rows = await db
        .select()
        .from(customerContacts)
        .where(eq(customerContacts.companyId, companyOf(req)))
        .orderBy(desc(customerContacts.createdAt))
        .limit(limit)
        .offset(offset);
      const data = rows.map(
        ({ portalAccessToken: _t, portalAccessExpiresAt: _e, ...c }: CustomerContact) => c
      );
      res.json({ data, limit, offset });
    })
  );

  router.post(
    "/contacts",
    scoped("write:contacts"),
    strictBody(v1CreateContactBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof v1CreateContactBody>>(req);
      const companyId = companyOf(req);
      const [contact] = await db
        .insert(customerContacts)
        .values({
          companyId,
          name: body.name,
          nameAr: body.nameAr ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          trnNumber: body.trnNumber ?? null,
          address: body.address ?? null,
          city: body.city ?? null,
          country: body.country ?? "UAE",
          emirate: body.emirate ?? null,
          paymentTerms: body.paymentTerms ?? 30,
        } as typeof customerContacts.$inferInsert)
        .returning();
      emitDomainEvent("contact.created", {
        companyId,
        entityId: contact.id,
        kind: "customer",
      });
      const { portalAccessToken: _t, portalAccessExpiresAt: _e, ...safe } = contact;
      res.status(201).json(safe);
    })
  );

  router.get(
    "/bills",
    scoped("read:bills"),
    asyncHandler(async (req: Request, res: Response) => {
      const { limit, offset } = page(parseQuery(listQuery, req));
      // vendor_bills is a raw-SQL table (no drizzle model).
      const { rows: data } = await pq(
        `SELECT id, vendor_id AS "vendorId", vendor_name AS "vendorName", vendor_trn AS "vendorTrn",
                bill_number AS "billNumber", bill_date AS "billDate", due_date AS "dueDate",
                currency, exchange_rate AS "exchangeRate", subtotal, vat_amount AS "vatAmount",
                total_amount AS "totalAmount", amount_paid AS "amountPaid", status, category,
                created_at AS "createdAt"
           FROM vendor_bills WHERE company_id = $1
          ORDER BY bill_date DESC, created_at DESC LIMIT $2 OFFSET $3`,
        [companyOf(req), limit, offset]
      );
      res.json({ data, limit, offset });
    })
  );

  router.get(
    "/accounts",
    scoped("read:accounts"),
    asyncHandler(async (req: Request, res: Response) => {
      const data = await db
        .select()
        .from(accounts)
        .where(eq(accounts.companyId, companyOf(req)))
        .orderBy(accounts.code);
      res.json({ data });
    })
  );

  router.get(
    "/reports/trial-balance",
    scoped("read:reports"),
    asyncHandler(async (req: Request, res: Response) => {
      const q = parseQuery(trialBalanceQuery, req);
      const tb = await trialBalance({
        companyId: companyOf(req),
        from: q.from ?? null,
        to: q.to ?? uaeToday(),
      });
      res.json(tb);
    })
  );

  router.use((_req: Request, res: Response) => {
    res.status(404).json({ message: "Unknown public API route", code: "NOT_FOUND" });
  });

  app.use("/api/v1", router);
}

/** Never expose share tokens or e-invoice payload internals over the public API. */
function publicInvoice<T extends Record<string, unknown>>(inv: T) {
  const {
    shareToken: _s,
    shareTokenExpiresAt: _se,
    einvoiceXml: _x,
    ...rest
  } = inv as T & { shareToken?: unknown; shareTokenExpiresAt?: unknown; einvoiceXml?: unknown };
  return rest;
}
