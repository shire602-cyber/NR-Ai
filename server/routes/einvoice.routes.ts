import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { companies, type Company, type Invoice } from "../../shared/schema";
import { getCapability } from "../../shared/capabilities";
import { zDate, zIbanAE, zText, zUuid } from "../../shared/validators/primitives";
import { generateEInvoiceXML, validateForEInvoicing } from "../services/einvoice.service";
import {
  EInvoiceProviderError,
  aspConfigured,
  getEInvoiceProvider,
  type EInvoiceProvider,
} from "../services/einvoice-provider";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";
import { findInvoiceForUser } from "./invoices.routes";
import { registerJob, listJobs } from "../platform/job-registry";
import { loadEInvoiceContext } from "../services/einvoice/context";
import {
  artefactStatus,
  summariseValidation,
  validateEInvoiceXml,
} from "../services/einvoice/validate";
import {
  getArchiveEntry,
  getEInvoiceDocument,
  listArchive,
  listEInvoiceDocuments,
  listInboundDocuments,
  upsertBuyerEndpoint,
  upsertEInvoiceDocument,
} from "../services/einvoice/store";
import { EINVOICE_TIMELINE, einvoicingScope } from "../services/einvoice/scope";
import {
  INBOUND_SIGNATURE_HEADER,
  INBOUND_TIMESTAMP_HEADER,
  inboundWebhookSecret,
  processInboundEInvoice,
  verifyInboundSignature,
} from "../services/einvoice/inbound";
import {
  cancelAndPersist,
  refreshAndPersist,
  runEInvoiceRetries,
  submitAndPersist,
} from "../services/einvoice/workflow";
import {
  LEGAL_ID_TYPES,
  PAYMENT_MEANS,
  PEPPOL_SCHEME_UAE_TIN,
  isUaeTin,
  tinFromTrn,
} from "../services/einvoice/pint-ae-codes";

const log = createLogger("einvoice");

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}

function activeProvider(): EInvoiceProvider {
  try {
    return getEInvoiceProvider();
  } catch (err) {
    // No accredited provider configured. Report this honestly as "not
    // available" rather than letting a mock fabricate an acceptance.
    throw new DomainError(
      err instanceof EInvoiceProviderError ? err.code : "EINVOICE_PROVIDER_NOT_CONFIGURED",
      503,
      undefined,
      (err as Error).message || "E-invoicing is not configured."
    );
  }
}

async function loadInvoiceAndCompany(
  req: Request
): Promise<{ invoice: Invoice; company: Company }> {
  const invoice = await findInvoiceForUser(userOf(req), req.params.id);
  if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
  const company = await storage.getCompany(invoice.companyId);
  if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404, undefined, "Company not found");
  return { invoice, company };
}

function providerInfo() {
  try {
    const p = getEInvoiceProvider();
    return { name: p.name, environment: p.environment, capabilities: p.capabilities, error: null };
  } catch (err) {
    return {
      name: null,
      environment: null,
      capabilities: null,
      error: err instanceof EInvoiceProviderError ? err.code : "EINVOICE_PROVIDER_NOT_CONFIGURED",
    };
  }
}

// ─── Validators ─────────────────────────────────────────────────────────

const PAYMENT_MEANS_CODES = Object.keys(PAYMENT_MEANS) as [string, ...string[]];
const LEGAL_ID_TYPE_CODES = Object.keys(LEGAL_ID_TYPES) as [string, ...string[]];

const settingsBody = z
  .object({
    peppolParticipantId: zText(64).nullable().optional(),
    peppolScheme: z
      .string()
      .regex(/^\d{4}$/, "Scheme must be a 4-digit ISO 6523 ICD")
      .nullable()
      .optional(),
    tradeLicenceNo: zText(64).nullable().optional(),
    tradeLicenceAuthority: zText(200).nullable().optional(),
    einvoicePayeeIban: zIbanAE.nullable().optional(),
    einvoicePaymentMeansCode: z.enum(PAYMENT_MEANS_CODES).nullable().optional(),
    einvoiceScope: z.enum(["b2b", "b2g", "b2b_b2g", "none"]).nullable().optional(),
    einvoiceTurnoverBand: z.enum(["large", "standard", "government"]).nullable().optional(),
    einvoiceGoLiveDate: zDate.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const scheme = v.peppolScheme ?? PEPPOL_SCHEME_UAE_TIN;
    if (
      v.peppolParticipantId &&
      scheme === PEPPOL_SCHEME_UAE_TIN &&
      !isUaeTin(v.peppolParticipantId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["peppolParticipantId"],
        message: "Under scheme 0235 the participant id is the 10-digit TIN starting with 1",
      });
    }
  });
type SettingsBody = z.output<typeof settingsBody>;

const buyerEndpointBody = z
  .object({
    participantId: zText(64).nullable().optional(),
    scheme: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    legalId: zText(64).nullable().optional(),
    legalIdType: z.enum(LEGAL_ID_TYPE_CODES).nullable().optional(),
    legalAuthority: zText(200).nullable().optional(),
  })
  .strict();
type BuyerEndpointBody = z.output<typeof buyerEndpointBody>;

const cancelBody = z.object({ reason: zText(500, { min: 3 }) }).strict();

function settingsView(company: Company) {
  const c = company as Company & Record<string, unknown>;
  const asp = getCapability("einvoicing_asp");
  const configured = aspConfigured();
  const secret = inboundWebhookSecret();
  return {
    companyId: company.id,
    identity: {
      legalName: company.legalName || company.name,
      trn: company.trnVatNumber,
      addressStreet: company.addressStreet || company.businessAddress,
      addressCity: company.addressCity,
      emirate: company.emirate,
      peppolParticipantId: c.peppolParticipantId ?? null,
      peppolScheme: c.peppolScheme ?? null,
      participantIdFallback: tinFromTrn(company.trnVatNumber),
      tradeLicenceNo: c.tradeLicenceNo ?? null,
      tradeLicenceAuthority: c.tradeLicenceAuthority ?? null,
      einvoicePayeeIban: c.einvoicePayeeIban ?? null,
      einvoicePaymentMeansCode: c.einvoicePaymentMeansCode ?? null,
    },
    scope: {
      ...einvoicingScope({
        einvoiceScope: c.einvoiceScope as string | null,
        einvoiceTurnoverBand: c.einvoiceTurnoverBand as string | null,
        einvoiceGoLiveDate: c.einvoiceGoLiveDate as string | null,
      }),
      timeline: EINVOICE_TIMELINE,
    },
    asp: {
      capability: asp,
      configured,
      // Accreditation and the commercial contract are external: until an ASP
      // is configured this stays "not connected — contract required".
      connected: configured && asp.status !== "requires_external",
      provider: providerInfo(),
    },
    inbound: {
      enabled: secret !== null,
      endpoint: `/api/webhooks/einvoice/${company.id}/inbound`,
      signatureHeader: INBOUND_SIGNATURE_HEADER,
      timestampHeader: INBOUND_TIMESTAMP_HEADER,
    },
    validation: artefactStatus(),
  };
}

export function registerEInvoiceRoutes(app: Express) {
  if (!listJobs().some((j) => j.name === "einvoice.retry")) {
    registerJob({
      name: "einvoice.retry",
      cron: "*/5 * * * *",
      description: "Retry e-invoice submissions that failed in transport (exponential backoff)",
      run: async () => {
        await runEInvoiceRetries();
      },
    });
  }

  // =====================================
  // E-Invoicing (PINT AE / UBL 2.1)
  // =====================================

  // Pre-submission validation: the fix-it list on the stored data, plus the
  // full XSD / schematron / rule result for a generated document.
  app.get(
    "/api/invoices/:id/einvoice/validate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice, company } = await loadInvoiceAndCompany(req);
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const ctx = await loadEInvoiceContext(invoice, company, lines);
      const issues = validateForEInvoicing(invoice, lines, company, ctx);
      const document = invoice.einvoiceXml
        ? summariseValidation(await validateEInvoiceXml(invoice.einvoiceXml))
        : null;
      res.json({ valid: issues.length === 0 && (document?.valid ?? true), issues, document });
    })
  );

  app.post(
    "/api/invoices/:id/generate-einvoice",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice, company } = await loadInvoiceAndCompany(req);
      const current = invoice.einvoiceStatus ?? "not_generated";
      if (["submitted", "accepted", "cleared"].includes(current)) {
        throw new DomainError(
          "EINVOICE_ALREADY_SUBMITTED",
          409,
          undefined,
          "This e-invoice is already with the service provider and cannot be regenerated"
        );
      }
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const ctx = await loadEInvoiceContext(invoice, company, lines);

      // A payload an ASP/FTA would reject must never be generated and stored.
      const issues = validateForEInvoicing(invoice, lines, company, ctx);
      if (issues.length > 0) {
        return res.status(422).json({
          message: "Invoice is not e-invoicing ready",
          code: "EINVOICE_VALIDATION_FAILED",
          issues,
        });
      }

      const { xml, uuid, hash, documentType } = generateEInvoiceXML(
        invoice,
        lines,
        company,
        ctx.customer,
        // S1: product GTIN / reverse-charge goods type per line, margin-scheme flag.
        { ...(ctx.options ?? {}), originalInvoice: ctx.originalInvoice, lineExtras: ctx.lineExtras }
      );
      const validation = summariseValidation(await validateEInvoiceXml(xml));
      if (!validation.valid) {
        log.warn({ id: invoice.id, validation }, "Generated e-invoice failed validation");
        return res.status(422).json({
          message: "The generated e-invoice failed PINT AE validation",
          code: "EINVOICE_SCHEMA_INVALID",
          validation,
        });
      }

      await storage.updateInvoice(invoice.id, invoice.companyId, {
        einvoiceUuid: uuid,
        einvoiceXml: xml,
        einvoiceHash: hash,
        einvoiceStatus: "generated",
      });
      await upsertEInvoiceDocument(company.id, invoice.id, {
        status: "generated",
        uuid,
        xmlHash: hash,
        documentType,
        validation,
        validatedAt: new Date(),
        lastError: null,
        rejectionReasons: null,
        nextRetryAt: null,
      });
      log.info({ id: invoice.id, uuid }, "Generated e-invoice");
      res.json({ uuid, hash, status: "generated", documentType, validation });
    })
  );

  app.get(
    "/api/invoices/:id/einvoice-xml",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice } = await loadInvoiceAndCompany(req);
      if (!invoice.einvoiceXml) {
        return res.status(404).json({
          message: "E-invoice has not been generated for this invoice",
          code: "EINVOICE_NOT_GENERATED",
        });
      }
      res.set("Content-Type", "application/xml");
      res.set("Content-Disposition", `attachment; filename="einvoice-${invoice.number}.xml"`);
      res.send(invoice.einvoiceXml);
    })
  );

  app.get(
    "/api/invoices/:id/einvoice/status",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice, company } = await loadInvoiceAndCompany(req);
      const doc = await getEInvoiceDocument(company.id, invoice.id);
      res.json({
        status: invoice.einvoiceStatus ?? "not_generated",
        detail: invoice.einvoiceStatusDetail ?? null,
        document: doc ?? null,
      });
    })
  );

  // Submit the e-invoice to the active ASP (provider-agnostic).
  app.post(
    "/api/invoices/:id/einvoice/submit",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice, company } = await loadInvoiceAndCompany(req);
      const provider = activeProvider();
      const result = await submitAndPersist({ invoice, company, provider });
      if (!result.ok) {
        return res.status(result.status).json({
          message: result.message,
          code: result.code,
          issues: result.issues,
          validation: result.validation,
        });
      }
      await recordAudit({
        userId: userOf(req),
        companyId: invoice.companyId,
        action: "invoice.einvoice_submit",
        entityType: "invoice",
        entityId: invoice.id,
        after: {
          provider: provider.name,
          environment: provider.environment,
          providerMessageId: result.providerMessageId,
          status: result.update.einvoiceStatus,
        },
        req,
      });
      res.json({
        status: result.update.einvoiceStatus,
        provider: provider.name,
        environment: provider.environment,
        providerMessageId: result.providerMessageId,
        attempts: result.documentRow.attempts,
        nextRetryAt: result.documentRow.nextRetryAt,
        reasons: result.documentRow.rejectionReasons,
      });
    })
  );

  // Poll the ASP for the latest status.
  app.post(
    "/api/invoices/:id/einvoice/refresh-status",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice, company } = await loadInvoiceAndCompany(req);
      const provider = activeProvider();
      const result = await refreshAndPersist({ invoice, company, provider });
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message, code: result.code });
      }
      res.json({
        status: result.update.einvoiceStatus,
        detail: result.update.einvoiceStatusDetail ?? null,
        reasons: result.documentRow.rejectionReasons,
      });
    })
  );

  // Withdraw a document before clearance (cleared invoices need a credit note).
  app.post(
    "/api/invoices/:id/einvoice/cancel",
    authMiddleware,
    requireCustomer,
    strictBody(cancelBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { invoice, company } = await loadInvoiceAndCompany(req);
      const { reason } = validated<z.output<typeof cancelBody>>(req);
      const provider = activeProvider();
      const result = await cancelAndPersist({ invoice, company, provider, reason });
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message, code: result.code });
      }
      await recordAudit({
        userId: userOf(req),
        companyId: invoice.companyId,
        action: "invoice.einvoice_cancel",
        entityType: "invoice",
        entityId: invoice.id,
        after: { reason, provider: provider.name },
        req,
      });
      res.json({ status: "cancelled" });
    })
  );

  // ─── Company-level settings, documents, archive, inbound ─────────────

  app.get(
    "/api/companies/:companyId/einvoicing/settings",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      res.json(settingsView(company));
    })
  );

  app.put(
    "/api/companies/:companyId/einvoicing/settings",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(settingsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = validated<SettingsBody>(req);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v;
      const [updated] = await db
        .update(companies)
        .set(patch)
        .where(eq(companies.id, companyId))
        .returning();
      if (!updated) throw new DomainError("COMPANY_NOT_FOUND", 404);
      await recordAudit({
        userId: userOf(req),
        companyId,
        action: "company.einvoicing_settings",
        entityType: "company",
        entityId: companyId,
        after: patch,
        req,
      });
      res.json(settingsView(updated));
    })
  );

  app.get(
    "/api/companies/:companyId/einvoicing/documents",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const rows = await listEInvoiceDocuments(req.params.companyId);
      const invoices = await Promise.all(
        rows.map((r) => storage.getInvoice(r.invoiceId, req.params.companyId))
      );
      res.json({
        items: rows.map((r, i) => ({
          ...r,
          invoiceNumber: invoices[i]?.number ?? null,
          customerName: invoices[i]?.customerName ?? null,
        })),
      });
    })
  );

  app.get(
    "/api/companies/:companyId/einvoicing/archive",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const before =
        typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before))
          ? new Date(req.query.before)
          : null;
      const limit = Number(req.query.limit) || 50;
      res.json({ items: await listArchive(req.params.companyId, { limit, before }) });
    })
  );

  app.get(
    "/api/companies/:companyId/einvoicing/archive/:archiveId",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const row = await getArchiveEntry(req.params.companyId, req.params.archiveId);
      if (!row) throw new DomainError("NOT_FOUND", 404, undefined, "Archive entry not found");
      res.set("Content-Type", "application/xml");
      res.set("X-Content-SHA256", row.sha256);
      res.set(
        "Content-Disposition",
        `attachment; filename="einvoice-${row.kind}-${row.documentNumber.replace(/[^\w.-]+/g, "_")}.xml"`
      );
      res.send(row.xml);
    })
  );

  app.get(
    "/api/companies/:companyId/einvoicing/inbound",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ items: await listInboundDocuments(req.params.companyId) });
    })
  );

  // Pull supplier documents from the ASP inbox (for ASPs without webhooks).
  app.post(
    "/api/companies/:companyId/einvoicing/inbound/poll",
    authMiddleware,
    requirePermission("documents.write"),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const provider = activeProvider();
      if (!provider.capabilities.receive) {
        throw new DomainError("EINVOICE_CAPABILITY_UNSUPPORTED", 501);
      }
      const items = await provider.receive(null);
      const results = [];
      for (const item of items) {
        try {
          const r = await processInboundEInvoice({
            company: company as Company & { peppolParticipantId?: string | null },
            xml: item.xml,
            providerMessageId: item.providerMessageId,
          });
          results.push({ providerMessageId: item.providerMessageId, status: r.status, ...r.body });
        } catch (err) {
          const e = err as DomainError;
          results.push({
            providerMessageId: item.providerMessageId,
            status: e.statusCode ?? 500,
            code: e.code,
          });
        }
      }
      res.json({ received: items.length, results });
    })
  );

  app.put(
    "/api/companies/:companyId/einvoicing/buyer-endpoints/:contactId",
    authMiddleware,
    requirePermission("documents.write"),
    strictBody(buyerEndpointBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contactId } = req.params;
      if (!zUuid.safeParse(contactId).success) throw new DomainError("NOT_FOUND", 404);
      const contact = await storage.getCustomerContact(contactId);
      if (!contact || contact.companyId !== companyId) {
        throw new DomainError("NOT_FOUND", 404, undefined, "Customer contact not found");
      }
      const body = validated<BuyerEndpointBody>(req);
      const scheme = body.scheme ?? PEPPOL_SCHEME_UAE_TIN;
      if (body.participantId && scheme === PEPPOL_SCHEME_UAE_TIN && !isUaeTin(body.participantId)) {
        throw new DomainError("VALIDATION_ERROR", 400, {
          fields: { participantId: ["Under scheme 0235 the participant id is the 10-digit TIN"] },
        });
      }
      const row = await upsertBuyerEndpoint(companyId, contactId, {
        participantId: body.participantId ?? null,
        scheme: body.scheme ?? null,
        legalId: body.legalId ?? null,
        legalIdType: body.legalIdType ?? null,
        legalAuthority: body.legalAuthority ?? null,
      });
      res.json(row);
    })
  );

  // ─── Inbound webhook (ASP → us), HMAC-signed, raw XML body ───────────

  app.post(
    "/api/webhooks/einvoice/:companyId/inbound",
    express.raw({
      type: ["application/xml", "text/xml", "application/octet-stream"],
      limit: "5mb",
    }),
    asyncHandler(async (req: Request, res: Response) => {
      const secret = inboundWebhookSecret();
      if (!secret) {
        return res.status(503).json({
          code: "EINVOICE_INBOUND_DISABLED",
          message: "Inbound e-invoicing is disabled: EINVOICE_INBOUND_WEBHOOK_SECRET is not set.",
        });
      }
      const { companyId } = req.params;
      const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const ok = verifyInboundSignature(
        raw,
        req.get(INBOUND_SIGNATURE_HEADER) ?? undefined,
        req.get(INBOUND_TIMESTAMP_HEADER) ?? undefined,
        companyId,
        secret
      );
      if (!ok) {
        return res
          .status(401)
          .json({ code: "EINVOICE_INBOUND_BAD_SIGNATURE", message: "Invalid signature" });
      }
      if (raw.length === 0) {
        return res.status(415).json({
          code: "EINVOICE_INBOUND_UNSUPPORTED_MEDIA",
          message: "Send the UBL document as application/xml",
        });
      }
      const company = zUuid.safeParse(companyId).success
        ? await storage.getCompany(companyId)
        : undefined;
      if (!company) return res.status(404).json({ code: "NOT_FOUND", message: "Unknown company" });
      const result = await processInboundEInvoice({
        company: company as Company & { peppolParticipantId?: string | null },
        xml: raw.toString("utf8"),
        providerMessageId: req.get("x-einvoice-message-id") ?? null,
      });
      res.status(result.status).json(result.body);
    })
  );
}
