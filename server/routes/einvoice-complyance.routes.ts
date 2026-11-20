/**
 * Complyance connection, onboarding and webhooks (E2). Mirrors einvoice-acube.routes.ts.
 *
 *   GET  /api/companies/:companyId/einvoicing/complyance           connection card state
 *   POST /api/companies/:companyId/einvoicing/complyance/connect   register the company (Connect)
 *   POST /api/companies/:companyId/einvoicing/complyance/sync      re-read / retry registration
 *   POST /api/companies/:companyId/einvoicing/complyance/link      attach a Complyance document id
 *                                                                  to an invoice (after GETS-HEAD-010)
 *   POST /api/webhooks/einvoice/complyance/:environment/:companyId  Complyance events (HMAC-signed)
 *
 * Without Complyance selected and configured every call answers 503
 * EINVOICE_PROVIDER_NOT_CONFIGURED; nothing claims a connection that does not exist.
 */
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireScopedCompanyPermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { listJobs, registerJob } from "../platform/job-registry";
import { invoices, type Company } from "../../shared/schema";
import { MOF_ASP_REGISTER_URL } from "../services/einvoice/providers/types";
import { companyProviderConfiguration } from "../services/einvoice/providers/company-provider";
import {
  COMPLYANCE_ACCREDITATION_NUMBER,
  COMPLYANCE_LEGAL_NAME,
  COMPLYANCE_PROVIDER_MODULE,
  COMPLYANCE_PROVIDER_NAME,
  ComplyanceEInvoiceProvider,
  complyanceDocumentBelongsTo,
  complyanceEnvironment,
} from "../services/einvoice/providers/complyance";
import {
  complyanceWebhookAlgorithm,
  complyanceWebhookMaxAgeSeconds,
  verifyComplyanceSignature,
} from "../services/einvoice/providers/complyance-signature";
import { normaliseComplyanceEvent } from "../services/einvoice/providers/complyance-events";
import {
  complyanceLegalEntityView,
  complyanceSteps,
  connectComplyanceCompany,
  syncComplyanceCompany,
  syncPendingComplyanceCompanies,
} from "../services/einvoice/providers/complyance-onboarding";
import {
  PROVIDER_EVENTS_JOB,
  enqueueProviderEvent,
  providerEventKey,
  providerEventSummary,
  runProviderEvents,
  runProviderPoll,
} from "../services/einvoice/provider-events";
import { companyTin, getLegalEntity } from "../services/einvoice/legal-entities";
import { refreshAndPersist, trackedEInvoiceProviderMatches } from "../services/einvoice/workflow";
import {
  documentProviderEnvironment,
  documentSubmissionMetadata,
  getEInvoiceDocument,
  lockEInvoiceInvoice,
  upsertEInvoiceDocument,
} from "../services/einvoice/store";
import { EINVOICE_TIMELINE, einvoicingScope } from "../services/einvoice/scope";
import { reportWindowDays } from "../services/einvoice/tracks";

const log = createLogger("einvoice-complyance-routes");

export const COMPLYANCE_POLL_JOB = "einvoice.complyancePoll";

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

function validated<T>(req: Request): T {
  return req.body as T;
}

async function complyanceConfiguration(company: Company) {
  return company.einvoicePartner === COMPLYANCE_PROVIDER_NAME
    ? companyProviderConfiguration(company.id, COMPLYANCE_PROVIDER_NAME)
    : null;
}

async function complyanceProvider(company: Company): Promise<ComplyanceEInvoiceProvider> {
  const config = await complyanceConfiguration(company);
  if (!config) throw new DomainError("EINVOICE_PROVIDER_NOT_CONFIGURED", 503);
  return new ComplyanceEInvoiceProvider(config.env);
}

function webhookBaseUrl(): string | null {
  const base = process.env.COMPLYANCE_WEBHOOK_BASE_URL || process.env.AUTH_PUBLIC_URL || "";
  return base ? base.replace(/\/+$/, "") : null;
}

const webhookPath = (environment: string, companyId: string) =>
  `/api/webhooks/einvoice/complyance/${environment}/${companyId}`;

export async function complyanceConnectionView(
  company: Company & Record<string, unknown>,
  le: Awaited<ReturnType<typeof getLegalEntity>>
) {
  const config = await complyanceConfiguration(company);
  const configured = !!config;
  const environment = complyanceEnvironment();
  const scope = einvoicingScope({
    einvoiceScope: (company.einvoiceScope as string | null) ?? null,
    einvoiceTurnoverBand: (company.einvoiceTurnoverBand as string | null) ?? null,
    einvoiceGoLiveDate: (company.einvoiceGoLiveDate as string | null) ?? null,
  });
  const base = webhookBaseUrl();
  return {
    provider: COMPLYANCE_PROVIDER_NAME,
    displayName: COMPLYANCE_PROVIDER_MODULE.displayName,
    legalName: COMPLYANCE_LEGAL_NAME,
    configured,
    environment,
    accreditationNumber: COMPLYANCE_ACCREDITATION_NUMBER,
    registerUrl: MOF_ASP_REGISTER_URL,
    emaraTaxListing: COMPLYANCE_PROVIDER_MODULE.emaraTaxListing,
    tin: companyTin(company as Company & { peppolParticipantId?: string | null }),
    legalEntity: complyanceLegalEntityView(le),
    canSend: configured && le?.status === "active",
    steps: complyanceSteps(configured, le),
    goLive: { ...scope, timeline: EINVOICE_TIMELINE, reportWindowDays: reportWindowDays() },
    webhook: {
      url: base ? `${base}${webhookPath(environment, company.id)}` : null,
      secretConfigured: !!config?.webhookSecret,
    },
  };
}

const connectBody = z
  .object({
    adminEmail: z.string().trim().email().max(254),
    contactName: z.string().trim().min(1).max(200).nullable().optional(),
    branchName: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict();
type ConnectBody = z.output<typeof connectBody>;

const emptyBody = z.object({}).strict();

/**
 * Outcomes after which a person may link the document Complyance holds: a plain duplicate number
 * (GETS-HEAD-010) and the X6a "needs link" state (the same answer after an ambiguous transport
 * error, when Complyance probably holds this very invoice).
 */
const LINKABLE_CODES: ReadonlySet<string> = new Set([
  "COMPLYANCE_DUPLICATE_NUMBER",
  "EINVOICE_NEEDS_LINK",
]);

const linkBody = z
  .object({
    invoiceId: z.string().uuid(),
    documentId: z
      .string()
      .trim()
      .min(6)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
type LinkBody = z.output<typeof linkBody>;

const webhookPayload = z.record(z.string(), z.unknown());

async function loadCompany(id: string) {
  return (await storage.getCompany(id)) as
    | (Company & { peppolParticipantId?: string | null })
    | undefined;
}

export function registerEInvoiceComplyanceRoutes(app: Express) {
  if (!listJobs().some((j) => j.name === PROVIDER_EVENTS_JOB)) {
    registerJob({
      name: PROVIDER_EVENTS_JOB,
      cron: "* * * * *",
      description: "Process queued e-invoicing provider events (webhooks and poll results)",
      run: async () => {
        await runProviderEvents();
      },
    });
  }
  if (!listJobs().some((j) => j.name === COMPLYANCE_POLL_JOB)) {
    registerJob({
      name: COMPLYANCE_POLL_JOB,
      cron: "*/10 * * * *",
      description:
        "Poll Complyance for in-flight e-invoice status, received purchases and pending onboarding",
      run: async () => {
        await syncPendingComplyanceCompanies(
          complyanceEnvironment(),
          loadCompany,
          async (company) => {
            const config = await complyanceConfiguration(company);
            return config ? new ComplyanceEInvoiceProvider(config.env) : null;
          }
        );
        await runProviderPoll(COMPLYANCE_PROVIDER_NAME);
        await runProviderEvents();
      },
    });
  }

  app.get(
    "/api/companies/:companyId/einvoicing/complyance",
    authMiddleware,
    requireScopedCompanyPermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const le = await getLegalEntity(
        company.id,
        COMPLYANCE_PROVIDER_NAME,
        complyanceEnvironment()
      );
      res.json({
        ...(await complyanceConnectionView(company as Company & Record<string, unknown>, le)),
        events: await providerEventSummary(company.id),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/complyance/connect",
    authMiddleware,
    requireScopedCompanyPermission("settings.company"),
    strictBody(connectBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const provider = await complyanceProvider(company);
      const body = validated<ConnectBody>(req);
      const le = await connectComplyanceCompany({
        company,
        provider,
        adminEmail: body.adminEmail,
        contactName: body.contactName ?? null,
        branchName: body.branchName ?? null,
      });
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "company.einvoicing_complyance_connect",
        entityType: "company",
        entityId: company.id,
        after: { tin: le.tin, status: le.status, environment: le.environment },
        req,
      });
      res.json(await complyanceConnectionView(company as Company & Record<string, unknown>, le));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/complyance/sync",
    authMiddleware,
    requireScopedCompanyPermission("settings.company"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const provider = await complyanceProvider(company);
      const le = await syncComplyanceCompany({ company, provider });
      res.json(await complyanceConnectionView(company as Company & Record<string, unknown>, le));
    })
  );

  // After an ambiguous transport failure Complyance answers GETS-HEAD-010 without the document
  // id and offers no sales listing: a person finds the id in the Complyance Invoice Portal and
  // links it here. We confirm it is this invoice (same number) AND this company's document (its
  // source, Connect company or seller TIN) before tracking it, since invoice numbers can
  // repeat across tenants. Linking changes what the invoice reports
  // to the FTA, so it needs the posting permission (POLICY_RULES has the same rule).
  app.post(
    "/api/companies/:companyId/einvoicing/complyance/link",
    authMiddleware,
    requireScopedCompanyPermission("ledger.post"),
    strictBody(linkBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const body = validated<LinkBody>(req);
      const invoice = await storage.getInvoice(body.invoiceId, company.id);
      if (!invoice) throw new DomainError("NOT_FOUND", 404, undefined, "Invoice not found");
      const doc = await getEInvoiceDocument(company.id, invoice.id);
      if (
        doc?.provider !== COMPLYANCE_PROVIDER_NAME ||
        !LINKABLE_CODES.has(doc.lastErrorCode ?? "") ||
        invoice.einvoiceProviderMessageId
      ) {
        throw new DomainError(
          "EINVOICE_LINK_NOT_NEEDED",
          409,
          undefined,
          "Only an invoice Complyance already holds without a tracked document id can be linked."
        );
      }
      const environment = documentProviderEnvironment(doc);
      const config = environment
        ? await companyProviderConfiguration(company.id, COMPLYANCE_PROVIDER_NAME, { environment })
        : null;
      if (!config) throw new DomainError("EINVOICE_PROVIDER_NOT_CONFIGURED", 503);
      const provider = new ComplyanceEInvoiceProvider(config.env);
      if (!(await trackedEInvoiceProviderMatches(doc, provider))) {
        throw new DomainError("EINVOICE_PROVIDER_NOT_CONFIGURED", 503);
      }
      const pin = documentSubmissionMetadata(doc);
      const r = await provider.call(
        "GET",
        `/api/v3/documents/${encodeURIComponent(body.documentId)}?type=sales`
      );
      const data = (((r.json ?? {}) as Record<string, unknown>).data ?? {}) as Record<
        string,
        unknown
      >;
      if (!r.ok || String(data.documentNumber ?? "") !== invoice.number) {
        throw new DomainError(
          "EINVOICE_LINK_MISMATCH",
          422,
          { documentId: body.documentId },
          "That Complyance document is not this invoice (its number differs or it was not found)."
        );
      }
      const le = await getLegalEntity(company.id, COMPLYANCE_PROVIDER_NAME, provider.environment);
      const leDetails = (le?.providerDetails ?? {}) as Record<string, unknown>;
      const owner = complyanceDocumentBelongsTo(data, {
        tin: le?.tin ?? companyTin(company),
        trn: company.trnVatNumber ?? le?.vatTrn ?? null,
        connectCompanyId: le?.legalEntityId ?? null,
        sourceName: typeof leDetails.sourceName === "string" ? leDetails.sourceName : null,
      });
      if (!owner.ok) {
        log.warn(
          { companyId: company.id, invoiceId: invoice.id, ...owner },
          "Complyance link refused: the document is not provably this company's"
        );
        throw new DomainError(
          "EINVOICE_LINK_MISMATCH",
          422,
          { documentId: body.documentId, checked: owner.checked, mismatched: owner.mismatched },
          owner.checked.length === 0
            ? "That Complyance document does not name its seller, so it cannot be confirmed as this company's."
            : "That Complyance document belongs to another seller."
        );
      }
      const fresh = await db.transaction(async (tx) => {
        const current = await lockEInvoiceInvoice(company.id, invoice.id, tx);
        if (!current) throw new DomainError("NOT_FOUND", 404);
        const currentDoc = await getEInvoiceDocument(company.id, invoice.id, tx);
        const currentPin = documentSubmissionMetadata(currentDoc);
        if (
          current.einvoiceProviderMessageId ||
          current.number !== invoice.number ||
          currentDoc?.provider !== COMPLYANCE_PROVIDER_NAME ||
          documentProviderEnvironment(currentDoc) !== environment ||
          currentPin?.operationId !== pin?.operationId ||
          currentPin?.scope !== pin?.scope ||
          !LINKABLE_CODES.has(currentDoc.lastErrorCode ?? "")
        ) {
          throw new DomainError("EINVOICE_LINK_NOT_NEEDED", 409);
        }
        const [linked] = await tx
          .update(invoices)
          .set({
            einvoiceProvider: COMPLYANCE_PROVIDER_NAME,
            einvoiceProviderMessageId: body.documentId,
            einvoiceStatus: "submitted",
            einvoiceStatusDetail: null,
          })
          .where(and(eq(invoices.id, invoice.id), eq(invoices.companyId, company.id)))
          .returning();
        await upsertEInvoiceDocument(
          company.id,
          invoice.id,
          {
            status: "submitted",
            provider: COMPLYANCE_PROVIDER_NAME,
            providerMessageId: body.documentId,
            rejectionReasons: null,
            lastError: null,
            nextRetryAt: null,
          },
          tx
        );
        return linked;
      });
      const out = await refreshAndPersist({ invoice: fresh, company, provider, source: "user" });
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "invoice.einvoice_complyance_link",
        entityType: "invoice",
        entityId: invoice.id,
        after: { documentId: body.documentId },
        req,
      });
      res.json({ linked: true, refreshed: out.ok });
    })
  );

  // ─── Webhook (Complyance → us) ─────────────────────────────────────

  app.post(
    "/api/webhooks/einvoice/complyance/:environment/:companyId?",
    express.raw({ type: "*/*", limit: "256kb" }),
    asyncHandler(async (req: Request, res: Response) => {
      const environment = req.params.environment;
      if (environment !== "sandbox" && environment !== "production") {
        return res.status(404).json({ code: "NOT_FOUND", message: "Unknown environment" });
      }
      // 5xx: Complyance retries (1, 5, 15, 15 min); a 4xx would be treated as permanent.
      const companyId = req.params.companyId?.toLowerCase();
      const config = companyId
        ? await companyProviderConfiguration(companyId, COMPLYANCE_PROVIDER_NAME, { environment })
        : null;
      if (!config) {
        return res.status(503).json({
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
          message: "Complyance is not connected for this environment.",
        });
      }
      const secret = config.webhookSecret;
      if (!secret) {
        // Never accept unsigned events.
        return res.status(503).json({
          code: "EINVOICE_WEBHOOK_SECRET_NOT_CONFIGURED",
          message: "Configure the signing secret for this company.",
        });
      }
      const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const verdict = verifyComplyanceSignature({
        raw,
        signature: req.get("x-webhook-signature"),
        secret,
        algorithm: complyanceWebhookAlgorithm(),
        timestamp: req.get("x-webhook-timestamp") ?? null,
        maxAgeSeconds: complyanceWebhookMaxAgeSeconds(),
      });
      if (!verdict.ok) {
        log.warn({ reason: verdict.reason }, "Complyance webhook signature refused");
        return res.status(401).json({
          code: "EINVOICE_WEBHOOK_BAD_SIGNATURE",
          message: "Invalid webhook signature",
          reason: verdict.reason,
        });
      }
      let json: unknown;
      try {
        json = JSON.parse(raw.toString("utf8"));
      } catch {
        return res.status(400).json({ code: "INVALID_JSON", message: "Body is not JSON" });
      }
      const parsed = webhookPayload.safeParse(json);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Expected an object" });
      }
      const event = normaliseComplyanceEvent(parsed.data);
      if (!event) return res.status(200).json({ received: true, ignored: true });
      const queued = await enqueueProviderEvent({
        provider: COMPLYANCE_PROVIDER_NAME,
        environment,
        type: event.type,
        eventId: providerEventKey(event.type, event.payload),
        companyId,
        payload: event.payload,
      });
      if (queued.id && process.env.COMPLYANCE_WEBHOOK_INLINE !== "false") {
        const id = queued.id;
        setImmediate(() => {
          runProviderEvents({ id, limit: 1 }).catch(() =>
            log.warn("immediate event processing failed")
          );
        });
      }
      res.status(200).json({ received: true, duplicate: queued.duplicate });
    })
  );
}
