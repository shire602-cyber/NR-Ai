/**
 * Complyance connection, onboarding and webhooks (E2). Mirrors einvoice-acube.routes.ts.
 *
 *   GET  /api/companies/:companyId/einvoicing/complyance           connection card state
 *   POST /api/companies/:companyId/einvoicing/complyance/connect   register the company (Connect)
 *   POST /api/companies/:companyId/einvoicing/complyance/sync      re-read / retry registration
 *   POST /api/companies/:companyId/einvoicing/complyance/link      attach a Complyance document id
 *                                                                  to an invoice (after GETS-HEAD-010)
 *   POST /api/webhooks/einvoice/complyance/:environment            Complyance events (HMAC-signed)
 *
 * Without Complyance selected and configured every call answers 503
 * EINVOICE_PROVIDER_NOT_CONFIGURED; nothing claims a connection that does not exist.
 */
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { listJobs, registerJob } from "../platform/job-registry";
import type { Company } from "../../shared/schema";
import { MOF_ASP_REGISTER_URL } from "../services/einvoice/providers/types";
import { providerIsActive } from "../services/einvoice/providers/registry";
import {
  COMPLYANCE_ACCREDITATION_NUMBER,
  COMPLYANCE_LEGAL_NAME,
  COMPLYANCE_PROVIDER_MODULE,
  COMPLYANCE_PROVIDER_NAME,
  ComplyanceEInvoiceProvider,
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
import { refreshAndPersist } from "../services/einvoice/workflow";
import { getEInvoiceDocument, upsertEInvoiceDocument } from "../services/einvoice/store";
import { EINVOICE_TIMELINE, einvoicingScope } from "../services/einvoice/scope";
import { reportWindowDays } from "../services/einvoice/tracks";

const log = createLogger("einvoice-complyance-routes");

export const COMPLYANCE_POLL_JOB = "einvoice.complyancePoll";

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

function validated<T>(req: Request): T {
  return req.body as T;
}

function complyanceActive(): boolean {
  return providerIsActive(COMPLYANCE_PROVIDER_NAME);
}

function complyanceProvider(): ComplyanceEInvoiceProvider {
  if (!complyanceActive()) {
    throw new DomainError(
      "EINVOICE_PROVIDER_NOT_CONFIGURED",
      503,
      undefined,
      "Complyance is not connected: set EINVOICE_PROVIDER=complyance with COMPLYANCE_API_KEY."
    );
  }
  return new ComplyanceEInvoiceProvider();
}

function webhookBaseUrl(): string | null {
  const base = process.env.COMPLYANCE_WEBHOOK_BASE_URL || process.env.AUTH_PUBLIC_URL || "";
  return base ? base.replace(/\/+$/, "") : null;
}

const webhookPath = (environment: string) => `/api/webhooks/einvoice/complyance/${environment}`;

export function complyanceConnectionView(
  company: Company & Record<string, unknown>,
  le: Awaited<ReturnType<typeof getLegalEntity>>
) {
  const configured = complyanceActive();
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
      url: base ? `${base}${webhookPath(environment)}` : null,
      secretConfigured: !!process.env.COMPLYANCE_WEBHOOK_SECRET,
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
        if (!complyanceActive()) return;
        const provider = new ComplyanceEInvoiceProvider();
        await syncPendingComplyanceCompanies(provider, loadCompany);
        await runProviderPoll(COMPLYANCE_PROVIDER_NAME, { provider });
        await runProviderEvents({ provider });
      },
    });
  }

  app.get(
    "/api/companies/:companyId/einvoicing/complyance",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const le = await getLegalEntity(
        company.id,
        COMPLYANCE_PROVIDER_NAME,
        complyanceEnvironment()
      );
      res.json({
        ...complyanceConnectionView(company as Company & Record<string, unknown>, le),
        events: await providerEventSummary(company.id),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/complyance/connect",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(connectBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const provider = complyanceProvider();
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
      res.json(complyanceConnectionView(company as Company & Record<string, unknown>, le));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/complyance/sync",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const provider = complyanceProvider();
      const le = await syncComplyanceCompany({ company, provider });
      res.json(complyanceConnectionView(company as Company & Record<string, unknown>, le));
    })
  );

  // After an ambiguous transport failure Complyance answers GETS-HEAD-010 without the document
  // id and offers no sales listing: a person finds the id in the Complyance Invoice Portal and
  // links it here. We confirm it is this invoice (same number) before tracking it.
  app.post(
    "/api/companies/:companyId/einvoicing/complyance/link",
    authMiddleware,
    requirePermission("documents.write"),
    strictBody(linkBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const provider = complyanceProvider();
      const body = validated<LinkBody>(req);
      const invoice = await storage.getInvoice(body.invoiceId, company.id);
      if (!invoice) throw new DomainError("NOT_FOUND", 404, undefined, "Invoice not found");
      const doc = await getEInvoiceDocument(company.id, invoice.id);
      if (
        doc?.lastErrorCode !== "COMPLYANCE_DUPLICATE_NUMBER" ||
        invoice.einvoiceProviderMessageId
      ) {
        throw new DomainError(
          "EINVOICE_LINK_NOT_NEEDED",
          409,
          undefined,
          "Only an invoice Complyance already holds without a tracked document id can be linked."
        );
      }
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
      await storage.updateInvoice(invoice.id, company.id, {
        einvoiceProvider: COMPLYANCE_PROVIDER_NAME,
        einvoiceProviderMessageId: body.documentId,
        einvoiceStatus: "submitted",
        einvoiceStatusDetail: null,
      });
      await upsertEInvoiceDocument(company.id, invoice.id, {
        status: "submitted",
        provider: COMPLYANCE_PROVIDER_NAME,
        providerMessageId: body.documentId,
        rejectionReasons: null,
        lastError: null,
        nextRetryAt: null,
      });
      const fresh = (await storage.getInvoice(invoice.id, company.id)) ?? invoice;
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
    "/api/webhooks/einvoice/complyance/:environment",
    express.raw({ type: "*/*", limit: "256kb" }),
    asyncHandler(async (req: Request, res: Response) => {
      const environment = req.params.environment;
      if (environment !== "sandbox" && environment !== "production") {
        return res.status(404).json({ code: "NOT_FOUND", message: "Unknown environment" });
      }
      // 5xx: Complyance retries (1, 5, 15, 15 min); a 4xx would be treated as permanent.
      if (!complyanceActive() || complyanceEnvironment() !== environment) {
        return res.status(503).json({
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
          message: "Complyance is not connected for this environment.",
        });
      }
      const secret = process.env.COMPLYANCE_WEBHOOK_SECRET;
      if (!secret) {
        // Never accept unsigned events.
        return res.status(503).json({
          code: "EINVOICE_WEBHOOK_SECRET_NOT_CONFIGURED",
          message: "Set COMPLYANCE_WEBHOOK_SECRET to the webhook's signing secret.",
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
      const event = normaliseComplyanceEvent({
        eventType: req.get("x-webhook-event"),
        eventId: req.get("x-webhook-id"),
        body: parsed.data,
      });
      if (!event) return res.status(200).json({ received: true, ignored: true });
      const queued = await enqueueProviderEvent({
        provider: COMPLYANCE_PROVIDER_NAME,
        environment,
        type: event.type,
        eventId: providerEventKey(event.type, event.payload),
        payload: event.payload,
      });
      if (queued.id && process.env.COMPLYANCE_WEBHOOK_INLINE !== "false") {
        const id = queued.id;
        setImmediate(() => {
          runProviderEvents({ id, limit: 1 }).catch((err) =>
            log.warn({ err: (err as Error).message }, "immediate event processing failed")
          );
        });
      }
      res.status(200).json({ received: true, duplicate: queued.duplicate });
    })
  );
}
